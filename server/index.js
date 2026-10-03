'use strict';
/**
 * 8K 游戏集成层 Mock API 服务器（Node >= 20，零依赖）
 * 启动： PORT=8088 node server/index.js
 */
const http = require('http');
const crypto = require('crypto');
const config = require('./lib/config');
const H = require('./lib/http');
const store = require('./lib/store');
const geo = require('./lib/geo');
const rg = require('./lib/rg');
const wallet = require('./lib/wallet');
const fs = require('fs');
const path = require('path');
const search = require('./lib/search');
const sign = require('./lib/sign');
const { toMinor } = require('./lib/money');
const adapters = require('./adapters');
const passwords = require('./lib/passwords');
const A = require('./lib/adminstate');
const seed = require('./lib/seed');
const adminRoutes = require('./admin/routes');
const { WalletError } = wallet;

const SESSION_TTL = 12 * 3600 * 1000;
const LAUNCH_TTL = 4 * 3600 * 1000;
const cur = config.regions.currency;

// ---------- 工具 ----------
const bad = (code, msg, http = 400, extra) => new WalletError(code, msg, http, extra);
function requireUser(ctx) {
  const m = /^Bearer\s+(\S+)$/.exec(ctx.req.headers.authorization || '');
  const s = m && store.sessions.get(m[1]);
  if (!s || s.exp < Date.now()) throw bad('UNAUTHORIZED', '未登录或会话已过期', 401);
  const u = store.users.get(s.userId);
  if (!u) throw bad('UNAUTHORIZED', '未登录或会话已过期', 401);
  if (u.frozen) { store.sessions.delete(m[1]); throw bad('ACCOUNT_FROZEN', '账户已被冻结，请联系客服', 403); }
  ctx.token = m[1];
  return (ctx.user = u);
}
function userByName(name) { // 精确匹配优先，其次不区分大小写
  const id = store.byName.get(name); if (id) return store.users.get(id);
  const low = name.toLowerCase(); for (const [n, uid] of store.byName) if (n.toLowerCase() === low) return store.users.get(uid);
  return null;
}
function amountOf(v) { const m = toMinor(v); if (m == null || m <= 0) throw bad('INVALID_AMOUNT', '金额必须大于 0，最多两位小数'); return m; }
function gameOf(id) {
  const g = config.catalog.games.find((x) => x.id === id);
  if (!g || g.enabled === false) throw bad('GAME_NOT_FOUND', '游戏不存在或已下架', 404);
  return g;
}
// 对外游戏对象：去掉内部/冗余扩展字段(providerGameId、币种/语言/地区备注、数据来源)，补 vendor/providerLabel/demo。
const INTERNAL = ['providerGameId', 'currencies', 'languages', 'regionNotes', 'source', 'extras', 'enabled', 'sort'];
// ---- 封面：public/assets/covers/<game_uid>.webp（HUIDU 素材包，covers.json 可选，给出宽高）。文件存在才对外给 thumb，前端缺图时回退到占位封面 ----
const COVER_DIR = path.join(config.env.publicDir, 'assets', 'covers');
let coverSet = new Set(), coverDims = {}, coverAt = 0;
function loadCovers() {
  coverAt = Date.now();
  try {
    const set = new Set();
    for (const f of fs.readdirSync(COVER_DIR)) { const m = /^([\w-]+)\.(webp|png|jpe?g)$/i.exec(f); if (m) set.add(m[1] + '.' + m[2].toLowerCase()); }
    coverSet = set;
  } catch { coverSet = new Set(); }
  try {
    const j = JSON.parse(fs.readFileSync(path.join(COVER_DIR, 'covers.json'), 'utf8')), d = {};
    const rows = Array.isArray(j) ? j : Array.isArray(j.covers) ? j.covers : Object.entries(j.covers || j).map(([k, v]) => Object.assign({ game_uid: k }, typeof v === 'object' ? v : {}));
    for (const r of rows) { const k = r && (r.game_uid || r.uid || r.id); if (k) d[k] = { w: +(r.width || r.w) || 0, h: +(r.height || r.h) || 0 }; }
    coverDims = d;
  } catch { coverDims = {}; }
}
function coverOf(g) {
  if (Date.now() - coverAt > 60000) loadCovers();
  const uid = g.providerGameId; if (!uid) return null;
  for (const ext of ['webp', 'png', 'jpg', 'jpeg']) if (coverSet.has(uid + '.' + ext)) { const d = coverDims[uid] || {}; return { thumb: '/assets/covers/' + uid + '.' + ext, thumbW: d.w || 0, thumbH: d.h || 0 }; }
  return null;
}
// 厂商 logo：public/assets/logos/logos.json（厂商名 → 相对路径）；文件存在才返回。部分 logo 是浅色透明底，前端放在深色底片上。
let logoMap = null;
function logoOf(v) {
  if (!logoMap) { logoMap = {}; try { const j = JSON.parse(fs.readFileSync(path.join(config.env.publicDir, 'assets', 'logos', 'logos.json'), 'utf8')); for (const [k, f] of Object.entries(j)) if (fs.existsSync(path.join(config.env.publicDir, 'assets', f))) logoMap[k] = '/assets/' + f; } catch { /* 无 logo 包 */ } }
  return logoMap[v] || null;
}
function pubGame(g, region) {
  const p = config.providers[g.provider] || {}, ad = adapters.get(g.provider);
  const o = Object.assign({}, g, coverOf(g) || {});
  for (const k of INTERNAL) delete o[k];
  return Object.assign(o, { vendor: g.vendor || p.label || g.provider, providerLabel: p.label || g.provider, demo: !!(g.demo || (ad && ad.isDemo && ad.isDemo())), playable: geo.categoryEnabled(region, g.category) && !!ad });
}
function walletOut(u) {
  return { balance: u.balance / 100, currency: cur.code, currencyLabel: cur.label, demo: true, region: u.region, limits: geo.limitsFor(u.region) };
}
// 部署在反向代理(Render/Nginx)之后时设置 TRUST_PROXY=1，才读取 X-Forwarded-For 的第一个地址作为客户端 IP（否则所有人共用代理 IP，限流会互相影响）。
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') { const x = req.headers['x-forwarded-for']; if (x) return String(x).split(',')[0].trim(); }
  return req.socket.remoteAddress;
}

// 客户端 Idempotency-Key：同一用户+key+路径+载荷 → 返回首次响应
function withIdem(ctx, fn) {
  const key = ctx.req.headers['idempotency-key'];
  if (!key) return fn();
  if (!/^[\w.:\-]{8,100}$/.test(key)) throw bad('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key 需 8-100 位字母数字或 . : _ -');
  const k = `${ctx.user.id}:${ctx.path}:${key}`;
  const h = crypto.createHash('sha256').update(ctx.raw || '').digest('hex');
  const ex = store.clientIdem.get(k);
  if (ex) { if (ex.hash !== h) throw bad('IDEMPOTENCY_CONFLICT', 'Idempotency-Key 已用于不同请求', 409); return Object.assign({}, ex.res, { idempotentReplay: true }); }
  const res = fn();
  store.clientIdem.set(k, { hash: h, res });
  if (store.clientIdem.size > 20000) store.clientIdem.delete(store.clientIdem.keys().next().value);
  return res;
}

// ---------- 路由 ----------
const routes = []; // [method, regex, keys, handler]
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push([method, re, keys, handler]);
}

route('GET', '/api/health', () => ({ ok: true, time: Date.now(), env: 'mock', providers: adapters.names() }));

route('GET', '/api/config', (ctx) => {
  const region = geo.resolveRegion(ctx.query.get('region') || ctx.req.headers['x-region']);
  return { currency: cur, region, categories: Object.entries(config.catalog.categories).map(([id, c]) => Object.assign({ id, enabled: geo.categoryEnabled(region, id) }, c)), limits: geo.limitsFor(region), ageGate: geo.regionCfg(region).ageGate, regions: Object.entries(config.regions.regions).map(([id, r]) => ({ id, label: r.label })), maintenance: A.publicMaintenance(), registrationOpen: !!A.settings.registrationOpen, demoLogin: process.env.SEED_DEMO !== '0' && !process.env.DEMO_PLAYER_PASSWORD && process.env.SHOW_DEMO_ACCOUNTS !== '0', demo: true };
});

// ---- 玩家认证：用户名 + 密码（scrypt）。⚠ 仅演示：未做邮箱/手机验证、KYC、2FA、找回密码。----
const USERNAME_RE = /^[\w\u4e00-\u9fa5\-]{2,32}$/;
const pfails = new Map(); // usernameLower -> {n, until}  玩家登录连续失败锁定
const P_LOCK_MAX = () => Number(process.env.PLAYER_LOCK_THRESHOLD) || 8, P_LOCK_MS = () => (Number(process.env.PLAYER_LOCK_MINUTES) || 10) * 60000;
function startSession(u) {
  const token = 'tk_' + crypto.randomBytes(24).toString('hex');
  store.sessions.set(token, { userId: u.id, exp: Date.now() + SESSION_TTL });
  rg.state(u.id).sessionStart = Date.now(); u.lastLoginAt = Date.now(); store.markDirty('users');
  return { token, expiresIn: SESSION_TTL / 1000, user: { id: u.id, username: u.username, region: u.region }, wallet: walletOut(u) };
}
route('POST', '/api/auth/register', async (ctx) => {
  if (!A.settings.registrationOpen) throw bad('REGISTRATION_CLOSED', '暂未开放注册', 403);
  const name = String(ctx.body.username || '').trim();
  if (!USERNAME_RE.test(name)) throw bad('INVALID_USERNAME', '用户名 2-32 位(字母数字汉字 _ -)');
  const pe = passwords.policy(ctx.body.password); if (pe) throw bad('WEAK_PASSWORD', pe);
  if (userByName(name)) throw bad('USERNAME_TAKEN', '该用户名已被注册', 409);
  const region = geo.resolveRegion(ctx.body.region || ctx.req.headers['x-region']);
  const pw = await passwords.hash(ctx.body.password);
  if (userByName(name)) throw bad('USERNAME_TAKEN', '该用户名已被注册', 409); // 哈希期间可能有并发注册
  const u = store.createUser(name, region, { pw });
  return Object.assign(startSession(u), { registered: true });
});
route('POST', '/api/auth/login', async (ctx) => {
  const name = String(ctx.body.username || '').trim().slice(0, 64), password = typeof ctx.body.password === 'string' ? ctx.body.password.slice(0, 256) : '';
  if (!name || !password) throw bad('INVALID_CREDENTIALS', '请输入用户名和密码', 400);
  const k = name.toLowerCase(), f = pfails.get(k), now = Date.now();
  if (f && f.until > now) return { status: 429, body: { ok: false, code: 'ACCOUNT_LOCKED', message: `登录失败次数过多，请 ${Math.ceil((f.until - now) / 60000)} 分钟后再试` } };
  const u = userByName(name);
  const ok = u && u.pw ? await passwords.verify(password, u.pw) : await passwords.verifyDummy(password);
  if (!ok) {
    const x = f && f.until && f.until <= now ? { n: 0, until: 0 } : f || { n: 0, until: 0 };
    x.n++; if (x.n >= P_LOCK_MAX()) { x.until = now + P_LOCK_MS(); x.n = 0; }
    pfails.set(k, x); if (pfails.size > 5000) pfails.delete(pfails.keys().next().value);
    throw bad('INVALID_CREDENTIALS', '用户名或密码错误', 401);
  }
  pfails.delete(k);
  if (u.frozen) throw bad('ACCOUNT_FROZEN', '账户已被冻结，请联系客服', 403);
  if (ctx.body.region) u.region = geo.resolveRegion(ctx.body.region); // 演示：允许切换地区以体验品类开关/限额
  return startSession(u);
});
route('POST', '/api/auth/logout', (ctx) => { requireUser(ctx); store.sessions.delete(ctx.token); return { ok: true }; });
route('GET', '/api/me', (ctx) => { const u = requireUser(ctx); return { user: { id: u.id, username: u.username, region: u.region }, wallet: walletOut(u), rg: rg.status(u.id), categories: geo.categoriesFor(u.region) }; });

route('GET', '/api/games', (ctx) => {
  const region = ctx.query.get('region') || ctx.req.headers['x-region'];
  const r = geo.resolveRegion(region);
  const q = (ctx.query.get('q') || '').trim();
  const cat = ctx.query.get('category'), prov = ctx.query.get('provider'), tag = ctx.query.get('tag'), sub = ctx.query.get('subcategory'), vendor = ctx.query.get('vendor');
  const enabled = geo.categoriesFor(r);
  const vendorOf = (g) => g.vendor || (config.providers[g.provider] || {}).label || g.provider;
  let list = config.catalog.games.filter((g) => g.enabled !== false && enabled[g.category] && adapters.get(g.provider));
  if (cat) list = list.filter((g) => g.category === cat);
  if (prov) list = list.filter((g) => g.provider === prov);
  if (vendor) list = list.filter((g) => vendorOf(g) === vendor);
  if (sub) list = list.filter((g) => g.subcategory === sub);
  if (tag) list = list.filter((g) => g.tags.includes(tag));
  if (q) list = list.filter((g) => search.matches(g, q, (config.catalog.categories[g.category] || {}).label));
  list = list.slice().sort((a, b) => (a.sort != null ? a.sort : 1e9) - (b.sort != null ? b.sort : 1e9)); // 默认=混排(见 lib/mix.js，由 adminstate 写入初始 sort)；后台“排序”：数字越小越靠前
  const total = list.length;
  const limit = Math.min(Math.max(parseInt(ctx.query.get('limit'), 10) || 100, 1), 1000);
  const page = Math.max(parseInt(ctx.query.get('page'), 10) || 1, 1);
  list = list.slice((page - 1) * limit, page * limit);
  const provs = {}, vend = {};
  for (const g of config.catalog.games) if (g.enabled !== false && enabled[g.category] && (!cat || g.category === cat) && adapters.get(g.provider)) { provs[g.provider] = config.providers[g.provider].label; const v = vendorOf(g); vend[v] = (vend[v] || 0) + 1; }
  const vendors = Object.keys(vend).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1).map((id) => ({ id, label: id, count: vend[id], logo: logoOf(id) }));
  return { region: r, total, page, limit, games: list.map((g) => pubGame(g, r)), providers: Object.entries(provs).map(([id, label]) => ({ id, label })), vendors, categories: Object.entries(config.catalog.categories).map(([id, c]) => Object.assign({ id, enabled: !!enabled[id] }, c)), aliases: search.ALIASES, demo: true };
});
route('GET', '/api/games/:id', (ctx) => { const u = ctx.optUser(); const g = gameOf(ctx.params.id); return { game: pubGame(g, u ? u.region : ctx.query.get('region')) }; });

route('GET', '/api/wallet', (ctx) => walletOut(requireUser(ctx)));
route('POST', '/api/wallet/deposit', (ctx) => {
  // 演示充值：真实环境由支付通道(出入金)异步回调入账，并需 KYC/风控。
  const u = requireUser(ctx);
  const r = wallet.deposit({ userId: u.id, amountMinor: amountOf(ctx.body.amount), txId: ctx.req.headers['idempotency-key'] || 'dep_' + crypto.randomBytes(8).toString('hex') });
  return Object.assign({ ok: true }, r.view);
});
route('GET', '/api/transactions', (ctx) => {
  const u = requireUser(ctx);
  const limit = Math.min(Math.max(parseInt(ctx.query.get('limit'), 10) || 50, 1), 200);
  const type = ctx.query.get('type');
  let list = store.ledgerOf(u.id).filter((e) => e.type !== 'cancelled' && (!type || e.type === type));
  const total = list.length;
  list = list.slice().reverse().slice(0, limit).map((e) => ({ txId: e.txId, provider: e.provider, type: e.type, amount: e.amount / 100, bet: e.bet != null ? e.bet / 100 : undefined, win: e.win != null ? e.win / 100 : undefined, balanceAfter: e.balanceAfter / 100, status: e.status, roundId: e.roundId || null, gameId: e.gameId || null, refTxId: e.refTxId || null, createdAt: e.createdAt, demo: true }));
  return { total, transactions: list, currency: cur.code };
});

route('POST', '/api/games/:id/launch', async (ctx) => {
  const u = requireUser(ctx);
  const g = gameOf(ctx.params.id);
  if (!geo.categoryEnabled(u.region, g.category)) throw bad('CATEGORY_DISABLED', '您所在地区暂未开放该品类', 403);
  const ad = adapters.get(g.provider);
  if (!ad) throw bad('PROVIDER_UNAVAILABLE', '供应商未启用', 503);
  const mt = A.publicMaintenance(); if (mt.blockPlay) throw bad('MAINTENANCE', mt.text || '平台维护中，暂时无法开始游戏', 503);
  const blk = rg.beforeBet(u.id, 0, {}); if (blk) throw bad(blk.code, blk.message, 403);
  const launchToken = 'lt_' + crypto.randomBytes(18).toString('hex');
  store.launches.set(launchToken, { userId: u.id, gameId: g.id, provider: g.provider, exp: Date.now() + LAUNCH_TTL });
  const base = config.env.publicBase || `${ctx.req.headers['x-forwarded-proto'] || 'http'}://${ctx.req.headers.host}`;
  let out;
  {
    const r = await ad.launch({ user: u, game: g, device: ctx.body.device || 'mobile', lang: ctx.body.lang || 'zh-CN', currency: cur.code, launchToken, returnUrl: ctx.body.returnUrl || base + '/', callbackBase: `${base}/provider/${g.provider}`, publicBase: config.env.publicBase, demo: true, transferAmountMinor: ctx.body.transferAmount != null ? amountOf(ctx.body.transferAmount) : null });
    out = { type: 'iframe', mode: r.mode, url: r.url, method: r.method || 'GET', fields: r.fields || null, expiresIn: r.expiresIn || null };
    if (r.providerBalance != null) out.providerBalance = r.providerBalance;
  }
  return Object.assign({ game: pubGame(g, u.region), launchToken, orientation: g.orientation, walletMode: ad.walletMode, balance: u.balance / 100, currency: cur.code, allowedOrigins: [] }, out);
});

// ---- 负责任博彩(桩) ----
route('GET', '/api/rg/status', (ctx) => rg.status(requireUser(ctx).id));
route('POST', '/api/rg/limits', (ctx) => {
  const u = requireUser(ctx), d = {};
  if (ctx.body.dailyDepositLimit !== undefined) d.dailyDepositLimitMinor = ctx.body.dailyDepositLimit === null ? null : amountOf(ctx.body.dailyDepositLimit);
  if (ctx.body.dailyLossLimit !== undefined) d.dailyLossLimitMinor = ctx.body.dailyLossLimit === null ? null : amountOf(ctx.body.dailyLossLimit);
  rg.setLimits(u.id, d); return rg.status(u.id);
});
route('POST', '/api/rg/exclude', (ctx) => {
  const u = requireUser(ctx); const hrs = Number(ctx.body.hours);
  if (!(hrs > 0 && hrs <= 24 * 365)) throw bad('INVALID_PARAMS', 'hours 取 (0, 8760]');
  rg.selfExclude(u.id, hrs, ctx.body.kind === 'cooloff' ? 'cooloff' : 'exclude'); return rg.status(u.id);
});

// ---- 转账钱包 ----
route('POST', '/api/wallet/transfer', async (ctx) => {
  const u = requireUser(ctx);
  const name = String(ctx.body.provider || ''); const ad = adapters.get(name);
  if (!ad || ad.walletMode !== 'transfer') throw bad('NOT_TRANSFER_PROVIDER', '该供应商不是转账钱包模式');
  const txId = ctx.req.headers['idempotency-key'] || 'tr_' + crypto.randomBytes(8).toString('hex');
  if (ctx.body.direction === 'in') { const r = await ad.transferIn({ user: u, amountMinor: amountOf(ctx.body.amount), txId }); return { ok: true, balance: u.balance / 100, providerBalance: r.providerBalance }; }
  const r = await ad.transferOut({ user: u, amountMinor: ctx.body.amount == null ? null : amountOf(ctx.body.amount), txId });
  return { ok: true, balance: u.balance / 100, transferred: (r.amountMinor || 0) / 100 };
});

// ---------- 供应商回调(共享钱包) ----------
// 两种入口：
//   1) /provider/:name/{balance|bet|win|rollback|refund}   —— 每个 action 一个 URL（模板适配器）
//   2) /provider/:name/callback                            —— 单一回调 URL，无 action（如 HUIDU）；action 由 adapter.resolveAction(req) 决定
// 可选适配器钩子：decodeCallback(req)(信封解密) · verifyCallback · resolveAction · formatDecodeError/formatAuthError ·
//   formatError(action, err, {userId, balance})（失败也要带余额的供应商，如 HUIDU）。
const CB = ['balance', 'bet', 'win', 'rollback', 'refund'];
async function providerCallback(ctx, name, action) {
  const ad = adapters.get(name);
  if (!ad) return { status: 404, body: { ok: false, code: 'UNKNOWN_PROVIDER' } };
  const cfg = config.providers[name];
  if (cfg.ipAllowlist && cfg.ipAllowlist.length && !cfg.ipAllowlist.includes(clientIp(ctx.req))) return { status: 403, body: { ok: false, code: 'IP_NOT_ALLOWED' } };
  if (action && Array.isArray(ad.callbackActions) && !ad.callbackActions.includes(action)) return { status: 404, body: { ok: false, code: 'NO_SUCH_CALLBACK', message: '该供应商不使用该回调路径' } };
  if (!action && typeof ad.resolveAction !== 'function') return { status: 404, body: { ok: false, code: 'NO_GENERIC_CALLBACK', message: '该供应商没有通用回调入口' } };
  const req = { headers: ctx.req.headers, rawBody: ctx.raw, query: Object.fromEntries(ctx.query), body: ctx.body, action, ip: clientIp(ctx.req) };
  if (typeof ad.decodeCallback === 'function') {
    const d = ad.decodeCallback(req);
    if (!d.ok) { console.warn(`[provider:${name}] 回调解码失败 ${d.reason}`); return ad.formatDecodeError ? ad.formatDecodeError(d.reason) : { status: 400, body: { ok: false, code: 'INVALID_PAYLOAD', message: d.reason } }; }
    req.body = d.body; req.envelope = d.envelope;
  }
  if (config.env.signatureMode !== 'off') {
    const v = ad.verifyCallback(req);
    if (!v.ok) {
      console.warn(`[provider:${name}] 签名校验失败 ${v.reason} ${action || 'callback'}`);
      if (config.env.signatureMode === 'enforce') return ad.formatAuthError ? ad.formatAuthError(v.reason) : { status: 401, body: { ok: false, code: 'INVALID_SIGNATURE', message: v.reason } };
    }
  }
  if (!action) action = ad.resolveAction(req);
  const info = { userId: null, balance: null };
  const bal = () => { const u = info.userId && store.users.get(info.userId); return u ? u.balance / 100 : null; };
  try {
    if (ad.walletMode !== 'shared') throw bad('WALLET_MODE_MISMATCH', '该供应商为转账钱包模式，不支持共享钱包回调', 409);
    const p = ad.parseCallback(action, { body: req.body, query: ctx.query, headers: ctx.req.headers }, info);
    let userId = p.userId;
    if (!userId && req.body.token) { const l = store.launches.get(req.body.token); if (l && l.exp > Date.now() && l.provider === name) userId = l.userId; }
    info.userId = info.userId || userId;
    if (!userId) throw bad('PLAYER_NOT_FOUND', '缺少玩家标识', 404);
    const base = { provider: name, userId, txId: p.txId, roundId: p.roundId, gameId: p.gameId, category: p.category };
    if (!base.category && p.gameId) { const g = config.catalog.games.find((x) => x.id === p.gameId); if (g) base.category = g.category; }
    let result;
    if (action === 'balance') { if (!store.users.get(userId)) throw bad('PLAYER_NOT_FOUND', '玩家不存在', 404); result = wallet.balance(userId); }
    else if (action === 'settle') {
      const bm = Number.isSafeInteger(p.betMinor) ? p.betMinor : toMinor(p.bet), wm = Number.isSafeInteger(p.winMinor) ? p.winMinor : toMinor(p.win);
      if (bm == null || wm == null) throw bad('INVALID_AMOUNT', '金额无效');
      result = wallet.settle(Object.assign(base, { betMinor: bm, winMinor: wm })).view;
    }
    else if (action === 'bet') result = wallet.bet(Object.assign(base, { amountMinor: amountOf(p.amount) })).view;
    else if (action === 'win') { const m = toMinor(p.amount); if (m == null) throw bad('INVALID_AMOUNT', '金额无效'); result = wallet.win(Object.assign(base, { amountMinor: m, refTxId: p.refTxId })).view; }
    else if (action === 'rollback' || action === 'refund') result = wallet[action](Object.assign(base, { refTxId: p.refTxId })).view;
    else throw bad('UNKNOWN_ACTION', '未知回调动作', 404);
    return ad.formatResponse(action, result);
  } catch (e) {
    info.balance = bal();
    if (e instanceof WalletError) return ad.formatError(action, e, info);
    if (typeof ad.decodeCallback === 'function') { console.error(`[provider:${name}] 回调内部错误`, e); return ad.formatError(action, new WalletError('INTERNAL_ERROR', '内部错误', 500), info); } // 加密型供应商：HTTP 恒 200，code=1 + 余额
    throw e;
  }
}
for (const a of CB) route('POST', `/provider/:name/${a}`, (ctx) => providerCallback(ctx, ctx.params.name, a));
route('POST', '/provider/:name/callback', (ctx) => providerCallback(ctx, ctx.params.name, null));

// ---- 开发辅助：模拟“供应商服务器”向自己回调(带签名)，供演示 iframe 游戏使用 ----
async function mockProviderCall(name, action, payload) {
  const cfg = config.providers[name];
  const raw = JSON.stringify(payload), ts = String(Date.now());
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/provider/${name}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timestamp': ts, 'X-Signature': sign.sign(cfg.secret, ts, raw), 'X-Api-Key': cfg.apiKey }, body: raw });
  return { status: r.status, body: await r.json() };
}
route('POST', '/api/mock/provider-spin', async (ctx) => { // 演示 iframe 老虎机：用 launchToken 作为身份
  if (!config.env.mockAdmin) throw bad('NOT_FOUND', '未找到', 404);
  const l = store.launches.get(ctx.body.token);
  if (!l || l.exp < Date.now()) throw bad('INVALID_LAUNCH_TOKEN', '启动令牌无效或已过期', 401);
  const amount = amountOf(ctx.body.amount);
  const id = 'rd_' + crypto.randomBytes(6).toString('hex');
  const g = config.catalog.games.find((x) => x.id === l.gameId);
  const common = { userId: l.userId, roundId: id, gameId: l.gameId, category: g.category };
  const b = await mockProviderCall(l.provider, 'bet', Object.assign({ txId: id + ':bet', amount }, common));
  if (b.status !== 200) return { status: b.status, body: b.body };
  const sym = ['🍒', '🍋', '🔔', '⭐', '7', '💎'];
  const reels = [0, 0, 0].map(() => crypto.randomInt(0, sym.length));
  const mult = reels[0] === reels[1] && reels[1] === reels[2] ? 10 : reels[0] === reels[1] || reels[1] === reels[2] ? 1.5 : 0;
  const winAmt = Math.floor(amount * mult) / 100;
  let balance = b.body.balance;
  if (winAmt > 0) { const w = await mockProviderCall(l.provider, 'win', Object.assign({ txId: id + ':win', amount: winAmt }, common)); balance = w.body.balance; }
  return { reels: reels.map((i) => sym[i]), win: winAmt, balance, roundId: id, demo: true };
});

route('POST', '/api/mock/huidu-spin', async (ctx) => { // 演示 iframe（模拟器模式）：模拟器以 HUIDU 的身份向本平台发加密回调
  if (!config.env.mockAdmin) throw bad('NOT_FOUND', '未找到', 404);
  const name = String(ctx.body.provider || 'huidu_seamless'); const ad = adapters.get(name);
  if (!ad || typeof ad.simPlay !== 'function' || !ad.isDemo()) throw bad('NOT_SIMULATOR', '该供应商不在模拟器模式', 400);
  const r = await ad.simPlay(String(ctx.body.session || ''), +amountOf(ctx.body.amount) / 100);
  if (!r.ok) return { status: r.code === 10025 || (r.raw && r.raw.msg === 'INSUFFICIENT_FUNDS') ? 402 : 400, body: { ok: false, code: (r.raw && r.raw.msg) || r.msg || 'FAILED', message: '下注失败', balance: r.balance } };
  return { reels: r.reels, win: r.win, balance: r.balance, roundId: r.round, demo: true };
});

// ---- 后台 /api/admin/*（独立会话，见 admin/routes.js）----
adminRoutes.install(route, { clientIp });
seed.seedPlayers();

// ---------- HTTP 服务器 ----------
const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  H.securityHeaders(res); H.cors(req, res);
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  const isApi = pathname.startsWith('/api/') || pathname.startsWith('/provider/');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!isApi) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      if (pathname === '/admin' || pathname === '/admin/') { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); return H.serveStatic(req, res, '/admin/index.html'); }
      if (pathname.startsWith('/admin/')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return H.serveStatic(req, res, pathname);
    }
    if (!H.rateLimit(clientIp(req), pathname.startsWith('/provider/') ? 'p' : 'g', pathname.startsWith('/provider/') ? (Number(process.env.PROVIDER_RATE_LIMIT_PER_MIN) || 6000) : 600, 60000)) return H.json(res, 429, { ok: false, code: 'RATE_LIMITED', message: '请求过于频繁' });
    if ((pathname === '/api/auth/login' || pathname === '/api/auth/register') && !H.rateLimit(clientIp(req), 'login', Number(process.env.LOGIN_RATE_LIMIT_PER_MIN) || 30, 60000)) return H.json(res, 429, { ok: false, code: 'RATE_LIMITED', message: '登录尝试过多' });
    let hit = null, params = {};
    for (const [m, re, keys, h] of routes) {
      if (m !== req.method) continue;
      const mm = re.exec(pathname);
      if (mm) { hit = h; keys.forEach((k, i) => (params[k] = decodeURIComponent(mm[i + 1]))); break; }
    }
    if (!hit) {
      const pathMatch = routes.some(([, re]) => re.test(pathname));
      return H.json(res, pathMatch ? 405 : 404, { ok: false, code: pathMatch ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', message: pathMatch ? '方法不允许' : '接口不存在' });
    }
    let raw = '', body = {};
    if (req.method === 'POST') {
      raw = await H.readBody(req);
      if (raw) { try { body = JSON.parse(raw); } catch { return /^\/provider\/[^/]+\/callback$/.test(pathname) ? H.json(res, 200, { code: 1, msg: 'payload error' }) : H.json(res, 400, { ok: false, code: 'INVALID_JSON', message: '请求体不是合法 JSON' }); } }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return H.json(res, 400, { ok: false, code: 'INVALID_JSON', message: '请求体必须是 JSON 对象' });
    }
    const ctx = { req, res, path: pathname, query: url.searchParams, params, body, raw, optUser() { try { return requireUser(ctx); } catch { return null; } } };
    const out = await hit(ctx);
    if (out && typeof out.status === 'number' && out.body) return H.json(res, out.status, out.body, out.headers);
    return H.json(res, 200, out);
  } catch (e) {
    if (e instanceof WalletError || e.http) return H.json(res, e.http || 400, Object.assign({ ok: false, code: e.code || 'ERROR', message: e.message }, e.extra || {}));
    console.error('[error]', req.method, pathname, e);
    return H.json(res, 500, { ok: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  } finally {
    if (process.env.ACCESS_LOG === '1') console.log(req.method, pathname, res.statusCode, Date.now() - t0 + 'ms');
  }
});
server.keepAliveTimeout = 65000;

if (require.main === module) {
  server.listen(config.env.port, config.env.host, () => {
    console.log(`8K mock API + 前端: http://localhost:${server.address().port}  (signatureMode=${config.env.signatureMode}, adapters=${adapters.names().join(',')})`);
  });
}
module.exports = { server };
