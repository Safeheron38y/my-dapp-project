'use strict';
/**
 * 后台管理 API：/api/admin/*  —— 与玩家体系完全分离：
 *  - 认证：管理员账号 + scrypt 密码；会话 Cookie `k8_admin`（HttpOnly + SameSite=Strict，HTTPS 下加 Secure）。令牌只以 SHA-256 摘要存于内存。
 *  - CSRF：除登录外所有 POST 必须带 `X-CSRF-Token`（登录/ me 返回）；同时校验 Origin 与 Host 同源。
 *  - 限流：登录按 IP 限流（默认 10 次 / 5 分钟）+ 按账号锁定（连续 5 次失败锁 15 分钟）。
 *  - 所有写操作进入审计日志（GET /api/admin/audit）。
 * 变更类接口一律用 POST（本服务器只实现 GET/POST）。
 */
const crypto = require('crypto');
const config = require('../lib/config');
const store = require('../lib/store');
const wallet = require('../lib/wallet');
const persist = require('../lib/persist');
const passwords = require('../lib/passwords');
const A = require('../lib/adminstate');
const H = require('../lib/http');
const adapters = require('../adapters');
const { WalletError } = wallet;

const COOKIE = 'k8_admin';
const IDLE_MS = 2 * 3600 * 1000, ABS_MS = 12 * 3600 * 1000;
const LOCK_MAX = Number(process.env.ADMIN_LOCK_THRESHOLD) || 5, LOCK_MS = (Number(process.env.ADMIN_LOCK_MINUTES) || 15) * 60000;
const TZ_MIN = Number.isFinite(+process.env.ADMIN_TZ_OFFSET_MIN) && process.env.ADMIN_TZ_OFFSET_MIN !== undefined ? +process.env.ADMIN_TZ_OFFSET_MIN : 480; // 报表按 UTC+8 切日

const sessions = new Map(); // sha256(token) -> {admin, csrf, created, last}
const fails = new Map();    // usernameLower -> {n, until}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const bad = (code, msg, http = 400, extra) => new WalletError(code, msg, http, extra);
const cur = config.regions.currency;

function parseCookies(h) { const o = {}; for (const p of String(h || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return o; }
function isHttps(req) { return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || /^https:/i.test(config.env.publicBase || ''); }
function cookie(req, val, maxAge) { return `${COOKIE}=${val}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`; }

function sessionOf(ctx) {
  const tok = parseCookies(ctx.req.headers.cookie)[COOKIE];
  if (!tok) return null;
  const k = sha(tok), s = sessions.get(k), now = Date.now();
  if (!s) return null;
  if (now - s.last > IDLE_MS || now - s.created > ABS_MS) { sessions.delete(k); return null; }
  s.last = now; s.key = k;
  return s;
}
function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}
// 包装：需要登录；POST 需要 CSRF
function auth(fn) {
  return (ctx) => {
    const s = sessionOf(ctx);
    if (!s) throw bad('ADMIN_UNAUTHORIZED', '请先登录后台', 401);
    if (ctx.req.method === 'POST') {
      if (!sameOrigin(ctx.req)) throw bad('BAD_ORIGIN', '来源不被允许', 403);
      const t = ctx.req.headers['x-csrf-token'];
      if (!t || t.length !== s.csrf.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(s.csrf))) throw bad('CSRF', '安全校验失败，请刷新页面重试', 403);
    }
    ctx.admin = s.admin; ctx.session = s;
    return fn(ctx);
  };
}

// ---------- 工具 ----------
const major = (m) => (m == null ? undefined : m / 100);
const int = (v, d, lo, hi) => Math.min(Math.max(parseInt(v, 10) || d, lo), hi);
function parseSigned(v) {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const m = Math.round(n * 100);
  return Math.abs(m / 100 - n) > 1e-9 ? null : m;
}
function parseTime(v, endOfDay) {
  if (v == null || v === '') return null;
  if (/^\d{10,}$/.test(String(v))) return Number(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.parse(v + 'T00:00:00Z') - TZ_MIN * 60000 + (endOfDay ? 86400000 - 1 : 0);
  const t = Date.parse(v); return Number.isNaN(t) ? null : t;
}
const dayKey = (t) => new Date(t + TZ_MIN * 60000).toISOString().slice(0, 10);
const gameName = (id) => { const g = config.catalog.games.find((x) => x.id === id); return g ? g.name : id || null; };
const providerLabel = (id) => (config.providers[id] || {}).label || id;

// 单条账本 → {bet, win}（分）。已冲正的 bet/win 不计入；冲正/退款/转账/充值/调整不计 GGR。
function betWin(e) {
  if (e.type === 'bet') return e.status === 'rolled_back' ? [0, 0] : [e.amount, 0];
  if (e.type === 'win') return e.status === 'rolled_back' ? [0, 0] : [0, e.amount];
  if (e.type === 'settle') return [e.bet || 0, e.win || 0];
  return [0, 0];
}
function entryView(e) {
  const u = store.users.get(e.userId);
  return { txId: e.txId, provider: e.provider, providerLabel: providerLabel(e.provider), type: e.type, amount: major(e.amount), bet: major(e.bet), win: major(e.win), balanceAfter: major(e.balanceAfter), status: e.status, roundId: e.roundId || null, gameId: e.gameId || null, gameName: e.gameId ? gameName(e.gameId) : null, refTxId: e.refTxId || null, userId: e.userId, username: u ? u.username : null, createdAt: e.createdAt, reason: e.meta && e.meta.reason || undefined, admin: e.meta && e.meta.admin || undefined };
}
const realEntries = () => { const a = []; for (const e of store.ledger.values()) if (e.type !== 'cancelled') a.push(e); return a; };

function userStats() { // userId -> {bet, win, rounds, deposits, last}
  const m = new Map();
  for (const e of realEntries()) {
    let s = m.get(e.userId); if (!s) m.set(e.userId, (s = { bet: 0, win: 0, rounds: 0, deposits: 0, last: 0 }));
    const [b, w] = betWin(e); s.bet += b; s.win += w; if (b > 0) s.rounds++;
    if (e.type === 'deposit') s.deposits += e.amount;
    if (e.createdAt > s.last) s.last = e.createdAt;
  }
  return m;
}
function userOut(u, st) {
  st = st || { bet: 0, win: 0, rounds: 0, deposits: 0, last: 0 };
  return { id: u.id, username: u.username, region: u.region, balance: u.balance / 100, frozen: !!u.frozen, frozenReason: u.frozenReason || null, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, lastActivityAt: st.last || null, hasPassword: !!u.pw, totalBet: st.bet / 100, totalWin: st.win / 100, ggr: (st.bet - st.win) / 100, rounds: st.rounds, deposits: st.deposits / 100 };
}

// ---------- 仪表盘 ----------
function dashboard() {
  const now = Date.now(), d0 = dayKey(now);
  const es = realEntries();
  const tot = { bet: 0, win: 0, rounds: 0, deposits: 0, adjust: 0 }, today = { bet: 0, win: 0 };
  const days = []; for (let i = 6; i >= 0; i--) days.push(dayKey(now - i * 86400000));
  const series = Object.fromEntries(days.map((d) => [d, { date: d, bets: 0, wins: 0 }]));
  const byGame = new Map(), active = new Set();
  for (const e of es) {
    const [b, w] = betWin(e);
    tot.bet += b; tot.win += w; if (b > 0) tot.rounds++;
    if (e.type === 'deposit') tot.deposits += e.amount;
    if (e.type === 'adjust') tot.adjust += e.amount;
    const dk = dayKey(e.createdAt);
    if (dk === d0) { today.bet += b; today.win += w; }
    if (series[dk]) { series[dk].bets += b / 100; series[dk].wins += w / 100; }
    if (e.createdAt >= now - 86400000 && (b > 0 || w > 0)) active.add(e.userId);
    if ((b || w) && e.gameId) { let g = byGame.get(e.gameId); if (!g) byGame.set(e.gameId, (g = { gameId: e.gameId, bet: 0, win: 0, rounds: 0 })); g.bet += b; g.win += w; if (b > 0) g.rounds++; }
  }
  const users = [...store.users.values()];
  const balSum = users.reduce((s, u) => s + u.balance, 0);
  const r2 = (n) => Math.round(n * 100) / 100;
  const topGames = [...byGame.values()].sort((a, b) => b.bet - a.bet).slice(0, 6).map((g) => ({ gameId: g.gameId, name: gameName(g.gameId), bets: g.bet / 100, wins: g.win / 100, ggr: (g.bet - g.win) / 100, rounds: g.rounds }));
  return {
    currency: cur.code, currencyLabel: cur.label, serverTime: now, persistence: persist.enabled(),
    players: { total: users.length, frozen: users.filter((u) => u.frozen).length, newToday: users.filter((u) => dayKey(u.createdAt) === d0).length, active24h: active.size },
    wallet: { total: balSum / 100, average: users.length ? r2(balSum / 100 / users.length) : 0, max: users.reduce((m, u) => Math.max(m, u.balance), 0) / 100 },
    totals: { bets: tot.bet / 100, wins: tot.win / 100, ggr: (tot.bet - tot.win) / 100, rtp: tot.bet ? r2((tot.win / tot.bet) * 100) : null, rounds: tot.rounds, deposits: tot.deposits / 100, adjustments: tot.adjust / 100 },
    today: { bets: today.bet / 100, wins: today.win / 100, ggr: (today.bet - today.win) / 100 },
    series: days.map((d) => ({ date: d, bets: r2(series[d].bets), wins: r2(series[d].wins), ggr: r2(series[d].bets - series[d].wins) })),
    topGames,
    recent: es.slice(-10).reverse().map(entryView),
    games: { total: config.catalog.games.length, enabled: config.catalog.games.filter((g) => g.enabled !== false).length },
    maintenance: A.publicMaintenance(),
  };
}

// ---------- 供应商状态（绝不返回 apiKey / secret / 代理 UID） ----------
function providersView() {
  const since = Date.now() - 86400000, stat = new Map();
  for (const e of realEntries()) {
    let s = stat.get(e.provider); if (!s) stat.set(e.provider, (s = { tx: 0, tx24h: 0, bet: 0, win: 0, last: 0 }));
    const [b, w] = betWin(e); s.tx++; s.bet += b; s.win += w; if (e.createdAt >= since) s.tx24h++; if (e.createdAt > s.last) s.last = e.createdAt;
  }
  const out = [];
  for (const [id, p] of Object.entries(config.providers)) {
    const ad = adapters.get(id), games = config.catalog.games.filter((g) => g.provider === id), s = stat.get(id) || { tx: 0, tx24h: 0, bet: 0, win: 0, last: 0 };
    let host = null; try { host = p.baseUrl ? new URL(p.baseUrl).host : null; } catch { host = '(无效)'; }
    const sim = !!(ad && ad.isDemo && ad.isDemo());
    const mode = !p.enabled || !ad ? 'disabled' : p.adapter === 'huidu' ? (sim ? 'simulator' : 'live') : p.adapter === '_template' ? 'placeholder' : 'mock';
    out.push({ id, label: p.label || id, adapter: p.adapter, enabled: !!p.enabled && !!ad, loaded: !!ad, hidden: !!p.hidden, walletMode: ad ? ad.walletMode : p.walletMode, currency: p.currency, mode,
      credentials: { baseUrl: !!p.baseUrl, apiKey: !!p.apiKey, secret: !!p.secret }, baseHost: host, ipAllowlist: (p.ipAllowlist || []).length, signatureMode: config.env.signatureMode,
      games: { total: games.length, enabled: games.filter((g) => g.enabled !== false).length }, activity: { tx: s.tx, tx24h: s.tx24h, bets: s.bet / 100, wins: s.win / 100, ggr: (s.bet - s.win) / 100, lastAt: s.last || null } });
  }
  return out;
}

// ---------- 路由 ----------
function install(route, { clientIp }) {
  // 登录 / 登出 / 当前会话
  route('POST', '/api/admin/login', async (ctx) => {
    const ip = clientIp(ctx.req);
    const max = Number(process.env.ADMIN_LOGIN_RATE_LIMIT) || 10;
    if (!H.rateLimit(ip, 'adminlogin', max, 5 * 60000)) return { status: 429, body: { ok: false, code: 'RATE_LIMITED', message: '登录尝试过于频繁，请 5 分钟后再试' }, headers: { 'Retry-After': '300' } };
    if (!sameOrigin(ctx.req)) throw bad('BAD_ORIGIN', '来源不被允许', 403);
    const username = String(ctx.body.username || '').trim().slice(0, 64), password = String(ctx.body.password || '').slice(0, 256);
    if (!username || !password) throw bad('INVALID_CREDENTIALS', '请输入账号和密码', 400);
    const key = username.toLowerCase(), f = fails.get(key), now = Date.now();
    if (f && f.until > now) return { status: 429, body: { ok: false, code: 'ACCOUNT_LOCKED', message: `尝试次数过多，账号已临时锁定，请 ${Math.ceil((f.until - now) / 60000)} 分钟后再试`, retryAfterSec: Math.ceil((f.until - now) / 1000) } };
    const adm = A.getAdmin(username);
    const ok = adm ? await passwords.verify(password, adm.pw) : await passwords.verifyDummy(password);
    if (!ok) {
      const x = f && f.until <= now && f.until ? { n: 0, until: 0 } : f || { n: 0, until: 0 };
      x.n++; if (x.n >= LOCK_MAX) { x.until = now + LOCK_MS; x.n = 0; }
      fails.set(key, x); if (fails.size > 5000) fails.delete(fails.keys().next().value);
      A.log(adm ? adm.username : username, 'login_failed', null, { ip });
      throw bad('INVALID_CREDENTIALS', '账号或密码错误', 401);
    }
    fails.delete(key);
    const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(24).toString('hex');
    sessions.set(sha(token), { admin: adm.username, csrf, created: now, last: now });
    adm.lastLoginAt = now; A.dirty(); A.log(adm.username, 'login', null, { ip });
    return { status: 200, body: { ok: true, admin: { username: adm.username }, csrf }, headers: { 'Set-Cookie': cookie(ctx.req, token, ABS_MS / 1000) } };
  });
  route('POST', '/api/admin/logout', auth((ctx) => { sessions.delete(ctx.session.key); return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': cookie(ctx.req, '', 0) } }; }));
  // 无需登录：前端启动时探测会话（避免未登录时出现 401 控制台噪音）
  route('GET', '/api/admin/session', (ctx) => { const s = sessionOf(ctx); return s ? { authenticated: true, admin: { username: s.admin }, csrf: s.csrf } : { authenticated: false }; });
  route('GET', '/api/admin/me', auth((ctx) => ({ admin: { username: ctx.admin }, csrf: ctx.session.csrf, currency: cur.code, currencyLabel: cur.label })));
  route('POST', '/api/admin/password', auth(async (ctx) => {
    const adm = A.getAdmin(ctx.admin), { oldPassword, newPassword } = ctx.body;
    if (!(await passwords.verify(String(oldPassword || ''), adm.pw))) throw bad('INVALID_CREDENTIALS', '原密码不正确', 401);
    const pe = passwords.policy(newPassword); if (pe) throw bad('WEAK_PASSWORD', pe);
    adm.pw = await passwords.hash(newPassword); A.dirty(); A.log(ctx.admin, 'change_password');
    for (const [k, s] of sessions) if (s.admin === adm.username && k !== ctx.session.key) sessions.delete(k);
    return { ok: true };
  }));

  route('GET', '/api/admin/dashboard', auth(() => dashboard()));

  // 玩家
  route('GET', '/api/admin/players', auth((ctx) => {
    const q = (ctx.query.get('q') || '').trim().toLowerCase(), status = ctx.query.get('status'), sort = ctx.query.get('sort') || 'created';
    const page = int(ctx.query.get('page'), 1, 1, 1e6), limit = int(ctx.query.get('limit'), 20, 1, 100);
    const st = userStats();
    let list = [...store.users.values()].filter((u) => (!q || u.username.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)) && (!status || (status === 'frozen' ? u.frozen : !u.frozen)));
    const key = { balance: (u) => u.balance, bet: (u) => (st.get(u.id) || { bet: 0 }).bet, login: (u) => u.lastLoginAt || 0, created: (u) => u.createdAt }[sort] || ((u) => u.createdAt);
    list.sort((a, b) => key(b) - key(a));
    const total = list.length;
    return { total, page, limit, players: list.slice((page - 1) * limit, page * limit).map((u) => userOut(u, st.get(u.id))) };
  }));
  const playerOr404 = (id) => { const u = store.users.get(id); if (!u) throw bad('PLAYER_NOT_FOUND', '玩家不存在', 404); return u; };
  route('GET', '/api/admin/players/:id', auth((ctx) => {
    const u = playerOr404(ctx.params.id), st = userStats().get(u.id);
    const page = int(ctx.query.get('page'), 1, 1, 1e6), limit = int(ctx.query.get('limit'), 20, 1, 100);
    const all = store.ledgerOf(u.id).filter((e) => e.type !== 'cancelled');
    const rows = all.slice().reverse().slice((page - 1) * limit, page * limit).map(entryView);
    return { player: userOut(u, st), ledger: { total: all.length, page, limit, rows }, currency: cur.code };
  }));
  route('POST', '/api/admin/players/:id/adjust', auth((ctx) => {
    const u = playerOr404(ctx.params.id);
    const m = parseSigned(ctx.body.amount); if (m == null || m === 0) throw bad('INVALID_AMOUNT', '请输入非零金额（正数加款，负数扣款，最多两位小数）');
    const reason = String(ctx.body.reason || '').trim(); if (reason.length < 2 || reason.length > 100) throw bad('REASON_REQUIRED', '请填写调整原因（2-100 字）');
    const r = wallet.adminAdjust({ userId: u.id, deltaMinor: m, reason, admin: ctx.admin });
    A.log(ctx.admin, 'adjust_balance', u.username, { amount: m / 100, reason, balanceAfter: u.balance / 100, txId: r.entry.txId });
    return { ok: true, balance: u.balance / 100, tx: entryView(r.entry) };
  }));
  route('POST', '/api/admin/players/:id/freeze', auth((ctx) => {
    const u = playerOr404(ctx.params.id), frozen = !!ctx.body.frozen;
    const reason = String(ctx.body.reason || '').trim().slice(0, 100);
    if (frozen && !reason) throw bad('REASON_REQUIRED', '冻结需要填写原因');
    u.frozen = frozen; u.frozenReason = frozen ? reason : null; u.frozenAt = frozen ? Date.now() : null;
    if (frozen) for (const [t, s] of store.sessions) if (s.userId === u.id) store.sessions.delete(t); // 立即踢下线
    store.markDirty('users'); A.log(ctx.admin, frozen ? 'freeze_player' : 'unfreeze_player', u.username, { reason });
    return { ok: true, player: userOut(u) };
  }));
  route('POST', '/api/admin/players/:id/password', auth(async (ctx) => {
    const u = playerOr404(ctx.params.id), pe = passwords.policy(ctx.body.password); if (pe) throw bad('WEAK_PASSWORD', pe);
    u.pw = await passwords.hash(ctx.body.password); store.markDirty('users');
    for (const [t, s] of store.sessions) if (s.userId === u.id) store.sessions.delete(t);
    A.log(ctx.admin, 'reset_player_password', u.username); return { ok: true };
  }));

  // 游戏
  route('GET', '/api/admin/games', auth((ctx) => {
    const q = (ctx.query.get('q') || '').trim().toLowerCase(), cat = ctx.query.get('category'), prov = ctx.query.get('provider'), en = ctx.query.get('enabled'), flag = ctx.query.get('flag');
    let list = config.catalog.games.map(A.gameView);
    if (q) list = list.filter((g) => g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q) || String(g.vendor).toLowerCase().includes(q));
    if (cat) list = list.filter((g) => g.category === cat);
    if (prov) list = list.filter((g) => g.provider === prov);
    if (en === '1' || en === '0') list = list.filter((g) => g.enabled === (en === '1'));
    if (flag === 'hot') list = list.filter((g) => g.hot); else if (flag === 'new') list = list.filter((g) => g.isNew);
    list.sort((a, b) => a.sort - b.sort || a.baseSort - b.baseSort);
    const page = int(ctx.query.get('page'), 1, 1, 1e6), limit = int(ctx.query.get('limit'), 30, 1, 300);
    const all = config.catalog.games;
    return { total: list.length, page, limit, games: list.slice((page - 1) * limit, page * limit),
      summary: { total: all.length, enabled: all.filter((g) => g.enabled !== false).length, hot: all.filter((g) => g.tags.includes('hot')).length, isNew: all.filter((g) => g.tags.includes('new')).length },
      categories: Object.entries(config.catalog.categories).map(([id, c]) => ({ id, label: c.label || id })), providers: [...new Set(all.map((g) => g.provider))].map((id) => ({ id, label: providerLabel(id) })) };
  }));
  const checkPatch = (b) => {
    if (b.category != null && !config.catalog.categories[b.category]) throw bad('INVALID_CATEGORY', '分类不存在');
    if (b.sort != null && (!Number.isFinite(+b.sort) || Math.abs(+b.sort) > 1e6)) throw bad('INVALID_SORT', '排序需为数字（越小越靠前）');
  };
  route('POST', '/api/admin/games/bulk', auth((ctx) => {
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.slice(0, 500) : []; if (!ids.length) throw bad('NO_SELECTION', '请选择游戏');
    checkPatch(ctx.body);
    let n = 0; for (const id of ids) if (A.setOverride(String(id), ctx.body)) n++;
    A.log(ctx.admin, 'games_bulk', `${n} 款`, { patch: ctx.body.reset ? 'reset' : { enabled: ctx.body.enabled, hot: ctx.body.hot, isNew: ctx.body.isNew, category: ctx.body.category } });
    return { ok: true, updated: n };
  }));
  route('POST', '/api/admin/games/:id', auth((ctx) => {
    checkPatch(ctx.body);
    const g = A.setOverride(ctx.params.id, ctx.body); if (!g) throw bad('GAME_NOT_FOUND', '游戏不存在', 404);
    A.log(ctx.admin, 'game_update', g.id, ctx.body.reset ? { reset: true } : { enabled: ctx.body.enabled, hot: ctx.body.hot, isNew: ctx.body.isNew, sort: ctx.body.sort, category: ctx.body.category });
    return { ok: true, game: A.gameView(g) };
  }));

  route('GET', '/api/admin/providers', auth(() => ({ providers: providersView(), signatureMode: config.env.signatureMode, note: '仅显示配置是否已设置，不返回任何密钥。' })));

  // 交易
  route('GET', '/api/admin/transactions', auth((ctx) => {
    const g = (k) => (ctx.query.get(k) || '').trim();
    const type = g('type'), status = g('status'), prov = g('provider'), uq = g('player').toLowerCase(), gq = g('game').toLowerCase(), q = g('q').toLowerCase();
    const from = parseTime(g('from')), to = parseTime(g('to'), true), min = g('min') !== '' ? Number(g('min')) : null, max = g('max') !== '' ? Number(g('max')) : null;
    const page = int(ctx.query.get('page'), 1, 1, 1e6), limit = int(ctx.query.get('limit'), 25, 1, 200);
    const uids = uq ? new Set([...store.users.values()].filter((u) => u.username.toLowerCase().includes(uq) || u.id.toLowerCase() === uq).map((u) => u.id)) : null;
    const all = realEntries();
    const out = [];
    for (let i = all.length - 1; i >= 0; i--) {
      const e = all[i];
      if (type && e.type !== type) continue;
      if (status && e.status !== status) continue;
      if (prov && e.provider !== prov) continue;
      if (uids && !uids.has(e.userId)) continue;
      if (from != null && e.createdAt < from) continue;
      if (to != null && e.createdAt > to) continue;
      if (gq && !(String(e.gameId || '').toLowerCase().includes(gq) || String(gameName(e.gameId) || '').toLowerCase().includes(gq))) continue;
      if (q && !(String(e.txId).toLowerCase().includes(q) || String(e.roundId || '').toLowerCase().includes(q))) continue;
      const a = Math.abs((e.type === 'settle' ? Math.max(e.bet || 0, e.win || 0) : e.amount) || 0) / 100;
      if (min != null && a < min) continue; if (max != null && a > max) continue;
      out.push(e);
    }
    let bets = 0, wins = 0; for (const e of out) { const [b, w] = betWin(e); bets += b; wins += w; }
    const types = [...new Set(all.map((e) => e.type))].sort(), providers = [...new Set(all.map((e) => e.provider))].sort().map((id) => ({ id, label: providerLabel(id) }));
    return { total: out.length, page, limit, summary: { bets: bets / 100, wins: wins / 100, ggr: (bets - wins) / 100 }, transactions: out.slice((page - 1) * limit, page * limit).map(entryView), types, providers, currency: cur.code };
  }));

  // 设置 / 审计
  const settingsOut = () => ({ settings: { maintenance: A.settings.maintenance, blockPlay: A.settings.blockPlay, registrationOpen: A.settings.registrationOpen },
    system: { persistence: persist.enabled(), dataDir: persist.enabled() ? persist.dir() : null, node: process.version, uptimeSec: Math.round(process.uptime()), signatureMode: config.env.signatureMode, publicBase: config.env.publicBase || null, players: store.users.size, ledgerEntries: store.ledger.size } });
  route('GET', '/api/admin/settings', auth(() => settingsOut()));
  route('POST', '/api/admin/settings', auth((ctx) => {
    const m = ctx.body.maintenance;
    if (m && m.enabled && !String(m.text != null ? m.text : A.settings.maintenance.text).trim()) throw bad('TEXT_REQUIRED', '开启横幅前请填写公告内容');
    A.updateSettings(ctx.body); A.log(ctx.admin, 'update_settings', null, { maintenance: A.settings.maintenance, blockPlay: A.settings.blockPlay, registrationOpen: A.settings.registrationOpen });
    return Object.assign({ ok: true }, settingsOut());
  }));
  route('GET', '/api/admin/audit', auth((ctx) => { const n = int(ctx.query.get('limit'), 50, 1, 200); return { entries: A.audit.slice(-n).reverse() }; }));
}

module.exports = { install, sessions };
