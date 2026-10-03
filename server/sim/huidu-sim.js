'use strict';
/**
 * HUIDU GameApi 本地模拟器（仅用于离线开发 / 自动化测试 / 演示，不是 HUIDU 的真实实现）。
 * 复刻 ANALYSIS.md 中“文档里写明的”行为：
 *   - 信封 {agency_uid, timestamp, payload}，payload = AES-256-ECB/PKCS7/Base64(JSON)
 *   - POST /game/v1（共享钱包启动）、POST /game/v2（转账钱包启动 + 转入/转出/查询）
 *   - POST /game/transaction/list（同一天 / 最近 60 天 / page_size 1~5000）
 *   - GET  /game/providers、GET /game/list
 *   - 回调：向启动时给的 callback_url 发送 {serial_number,currency_code,game_uid,member_account,win_amount,bet_amount,timestamp,game_round}，
 *           期望响应 {code:0,payload:AES({credit_amount,timestamp})}；“返回 code=0 且余额>=0 才算成功”；失败按 retry 重试同一 serial_number。
 *   - 文档错误码 100xx（见 ERR）。
 * 文档未说明的地方（重试间隔、超时、限流阈值、测试环境限制）这里不模拟。
 * 凭据由调用方传入（测试/内置模式随机生成）——本文件不含任何真实或文档示例密钥。
 *
 * 独立运行：  node server/sim/huidu-sim.js     （HUIDU_SIM_PORT=8090 HUIDU_SIM_MODE=shared|transfer，凭据读 HUIDU_SIM_AGENCY_UID / HUIDU_SIM_AES_KEY，缺省则随机生成并打印）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encrypt, decrypt, validKey } = require('../lib/huidu-crypto');

const ERR = {
  10002: 'Agency not exist', 10004: 'payload error', 10005: 'System error', 10008: 'The game does not exist',
  10011: 'Player currencies do not match', 10013: 'Currency is not supported', 10015: 'Player account, limited to a-z and 0-9',
  10016: 'The account has been frozen. Please contact the administrator', 10017: 'Manufacturer does not exist',
  10022: 'Incorrect parameters', 10023: 'The player name must be at least 3 characters long', 10024: 'Wallet mode does not match',
  10025: 'Insufficient wallet balance', 10026: 'Transfer failed', 10027: 'The transfer order already exists',
  10028: 'Start and end date cannot be empty', 10029: 'The start and end dates must be the same day', 10030: 'Too many requests, please try again later',
  10031: 'Only data within the last 60 days can be queried', 10032: 'End date must be greater than start date', 10033: 'home_url cannot contain ?',
  10034: 'System Scheduled Maintenance',
};
const CURRENCIES = ['USD', 'INR', 'IDR', 'THB', 'VND', 'PHP', 'MYR', 'BRL', 'CNY', 'EUR', 'JPY', 'KRW', 'USDT'];
const DAY = 86400000;
const fmt = (c) => (c / 100).toFixed(2);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
function utcStr(ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 19); }
function toCents(v) { // 带符号的元 → 分；非法返回 null
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string' || !/^-?\d+(\.\d{1,2})?$/.test(v.trim())) return null;
  const n = Number(v); return Math.round(n * 100);
}
const TYPE_BY_CAT = { slots: 'Slot', fishing: 'Fish', live: 'CasinoLive', table: 'Table', crash: 'Crash', sports: 'Sports' };

function defaultCatalog() {
  const dir = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
  let games = [];
  try { games = JSON.parse(fs.readFileSync(path.join(dir, 'games.huidu-shortlist.json'), 'utf8')).games || []; } catch { /* 无清单则空目录 */ }
  const providers = new Map(); const list = [];
  for (const g of games) {
    const code = slug(g.vendor || 'vendor');
    if (!providers.has(code)) providers.set(code, { code, name: g.vendor || code, currency: 'USD', lang: 'en', status: 1 });
    list.push({ code, game_uid: g.providerGameId, game_name: g.name, game_type: TYPE_BY_CAT[g.category] || 'Slot', lang: 'en', status: 1, currency: 'USD' });
  }
  // 一个已下架厂商 + 一个下架游戏，用来验证“status=0 不入库”
  providers.set('retiredvendor', { code: 'retiredvendor', name: 'RetiredVendor-已下架', currency: 'USD', lang: 'en', status: 0 });
  list.push({ code: 'retiredvendor', game_uid: 'f'.repeat(32), game_name: 'Retired Game', game_type: 'Slot', lang: 'en', status: 1, currency: 'USD' });
  if (providers.has('pgsoft')) list.push({ code: 'pgsoft', game_uid: 'e'.repeat(32), game_name: 'Paused Game', game_type: 'Slot', lang: 'en', status: 0, currency: 'USD' });
  return { providers: [...providers.values()], games: list };
}

function createSimulator(opts) {
  opts = Object.assign({ walletMode: 'shared', encryptResponses: false, retryDelayMs: 5, catalog: null, defaultCallbackUrl: '' }, opts);
  if (!opts.agencyUid) throw new Error('simulator: agencyUid required');
  if (!validKey(opts.aesKey)) throw new Error('simulator: aesKey must be 32 bytes');
  const cat = opts.catalog || defaultCatalog();
  const st = { players: new Map(), sessions: new Map(), transfers: new Map(), txs: [], fail: {}, calls: [], mode: opts.walletMode, frozen: new Set() };
  const gameByUid = new Map(cat.games.map((g) => [g.game_uid, g]));
  let server = null, baseUrl = '';

  const ok = (payload) => ({ code: 0, msg: '', payload: opts.encryptResponses && payload && typeof payload === 'object' ? encrypt(payload, opts.aesKey) : payload });
  const bad = (code) => ({ code, msg: ERR[code] || 'error' });
  const player = (m) => st.players.get(m);

  function openEnvelope(body) {
    if (!body || body.agency_uid !== opts.agencyUid) return { err: bad(10002) };
    if (typeof body.payload !== 'string') return { err: bad(10004) };
    try { const p = decrypt(body.payload, opts.aesKey); return { p }; } catch { return { err: bad(10004) }; }
  }
  function newSession(member, game_uid, extra) {
    const id = 's' + crypto.randomBytes(12).toString('hex');
    st.sessions.set(id, Object.assign({ id, member, game_uid, createdAt: Date.now() }, extra));
    return id;
  }
  function checkMember(p) {
    const m = p.member_account;
    if (typeof m !== 'string' || !m) return 10022;
    if (!/^[a-z0-9]+$/.test(m)) return 10015;
    if (m.length < 3) return 10023;
    return 0;
  }
  function ensurePlayer(m, currency) {
    let pl = player(m);
    if (!pl) { pl = { member: m, currency, balance: 0 }; st.players.set(m, pl); }
    return pl;
  }

  // ---- POST /game/v1 ----
  function launchV1(p) {
    if (st.mode !== 'shared') return bad(10024);
    const e = checkMember(p); if (e) return bad(e);
    const g = gameByUid.get(p.game_uid); if (!g) return bad(10008);
    if (toCents(p.credit_amount) == null) return bad(10022);
    if (!CURRENCIES.includes(p.currency_code)) return bad(10013);
    if (typeof p.home_url === 'string' && p.home_url.includes('?')) return bad(10033);
    if (st.frozen.has(p.member_account)) return bad(10016);
    const pl = ensurePlayer(p.member_account, p.currency_code);
    if (pl.currency !== p.currency_code) return bad(10011);
    const sid = newSession(pl.member, p.game_uid, { callback_url: p.callback_url || opts.defaultCallbackUrl, currency: pl.currency, platform: p.platform || '1', lang: p.language || 'en', home_url: p.home_url || '', extras: p.extras });
    return ok({ game_launch_url: `${baseUrl}/sim/game?session=${sid}` });
  }
  // ---- POST /game/v2 ----
  function launchV2(p) {
    if (st.mode !== 'transfer') return bad(10024);
    const e = checkMember(p); if (e) return bad(e);
    if (!p.transfer_id || typeof p.transfer_id !== 'string') return bad(10022);
    const amt = toCents(p.credit_amount); if (amt == null) return bad(10022);
    if (!CURRENCIES.includes(p.currency_code)) return bad(10013);
    if (p.game_uid && !gameByUid.get(p.game_uid)) return bad(10008);
    if (typeof p.home_url === 'string' && p.home_url.includes('?')) return bad(10033);
    if (st.frozen.has(p.member_account)) return bad(10016);
    const pl = ensurePlayer(p.member_account, p.currency_code);
    if (pl.currency !== p.currency_code) return bad(10011);
    if (st.transfers.has(p.transfer_id)) return bad(10027);
    const f = st.fail.transfer; if (f && amt !== 0) { delete st.fail.transfer; if (f === 'code10026') return bad(10026); }
    const before = pl.balance; let status = 1;
    if (amt < 0 && before < -amt) return bad(10025);
    if (f === 'status2' && amt !== 0) status = 2; else pl.balance += amt;
    const rec = { transfer_id: p.transfer_id, member: pl.member, amount: amt, before, after: pl.balance, status, txid: 'T' + crypto.randomBytes(6).toString('hex'), at: Date.now() };
    st.transfers.set(p.transfer_id, rec);
    const out = { player_name: pl.member, currency: pl.currency, transfer_amount: fmt(Math.abs(amt)), before_amount: fmt(before), after_amount: fmt(pl.balance), transfer_id: p.transfer_id, transaction_id: rec.txid, transfer_status: status, timestamp: Date.now() };
    if (p.game_uid) out.game_launch_url = `${baseUrl}/sim/game?session=${newSession(pl.member, p.game_uid, { callback_url: '', currency: pl.currency, platform: p.platform || '1', lang: p.language || 'en' })}`;
    return ok(out);
  }
  // ---- POST /game/transaction/list ----
  function txList(p) {
    const from = Number(p.from_date), to = Number(p.to_date);
    if (!p.from_date || !p.to_date || !Number.isFinite(from) || !Number.isFinite(to)) return bad(10028);
    if (Math.floor(from / DAY) !== Math.floor(to / DAY)) return bad(10029);
    if (from < Date.now() - 60 * DAY) return bad(10031);
    if (to <= from) return bad(10032);
    const pn = Number(p.page_no || 1), ps = Number(p.page_size || 100);
    if (!Number.isInteger(pn) || pn < 1 || !Number.isInteger(ps) || ps < 1 || ps > 5000) return bad(10022);
    const rows = st.txs.filter((t) => t.ms >= from && t.ms <= to);
    const recs = rows.slice((pn - 1) * ps, pn * ps).map((t) => ({ agency_uid: opts.agencyUid, member_account: t.member, bet_amount: fmt(t.bet), win_amount: fmt(t.win), currency_code: t.currency, serial_number: t.serial, game_round: t.round, game_uid: t.game_uid, timestamp: utcStr(t.ms) }));
    return ok({ total_count: rows.length, current_page: pn, page_size: ps, records: recs });
  }
  function providers(q) {
    if (q.get('agency_uid') !== opts.agencyUid) return bad(10002);
    const code = q.get('code');
    return { code: 0, msg: '', data: cat.providers.filter((x) => !code || x.code === code) };
  }
  function gameList(q) {
    if (q.get('agency_uid') !== opts.agencyUid) return bad(10002);
    const code = q.get('code'); if (!code) return bad(10022);
    if (!cat.providers.some((x) => x.code === code)) return bad(10017);
    return { code: 0, msg: '', data: cat.games.filter((g) => g.code === code).map(({ code: _c, ...g }) => g) };
  }

  // ---- 回调（模拟 HUIDU → 运营商） ----
  async function post(url, envelope, timeoutMs) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs || 8000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope), signal: ctl.signal });
      const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { /* 非 JSON */ }
      return { http: r.status, json: j };
    } finally { clearTimeout(t); }
  }
  function buildCallback(sess, { bet, win, round, serial, ts }) {
    const payload = { serial_number: serial, currency_code: sess.currency, game_uid: sess.game_uid, member_account: sess.member, win_amount: fmt(win), bet_amount: fmt(bet), timestamp: String(ts || Date.now()), game_round: round };
    return { agency_uid: opts.agencyUid, timestamp: String(Date.now()), payload: encrypt(payload, opts.aesKey), _plain: payload };
  }
  function readBalance(resp) {
    if (!resp || !resp.json) return { ok: false, balance: null };
    const j = resp.json; let bal = null;
    try { const pl = typeof j.payload === 'string' ? decrypt(j.payload, opts.aesKey) : j.payload; if (pl && pl.credit_amount != null) bal = Number(pl.credit_amount); } catch { /* 解密失败 */ }
    return { ok: j.code === 0 && bal != null && bal >= 0, code: j.code, msg: j.msg, balance: bal };
  }
  /**
   * 一局：bet/win 为“元”(可为负数 = 退款)。共享钱包 → 回调运营商；转账钱包 → 改本地玩家余额。
   * opts2: { session | member, game_uid, round, serial, retry(失败重试次数), bet, win }
   */
  async function play(o) {
    const sess = o.session ? st.sessions.get(o.session) : null;
    if (o.session && !sess) return { ok: false, code: 10005, msg: 'session not found' };
    const s = sess || { member: o.member, game_uid: o.game_uid, currency: (player(o.member) || {}).currency || 'USD', callback_url: o.callback_url || opts.defaultCallbackUrl };
    const bet = Math.round((o.bet || 0) * 100), win = Math.round((o.win || 0) * 100);
    const serial = o.serial || crypto.randomUUID(), round = o.round || 'r' + crypto.randomBytes(5).toString('hex'), ts = o.ts || Date.now();
    if (st.mode === 'transfer') {
      const pl = player(s.member); if (!pl) return { ok: false, code: 10014, msg: 'player' };
      if (pl.balance + win - bet < 0) return { ok: false, code: 10025, msg: ERR[10025], balance: pl.balance / 100 };
      pl.balance += win - bet;
      st.txs.push({ member: s.member, bet, win, currency: s.currency, serial, round, game_uid: s.game_uid, ms: ts });
      return { ok: true, code: 0, balance: pl.balance / 100, serial_number: serial, round, mode: 'transfer' };
    }
    if (!s.callback_url) return { ok: false, code: 10005, msg: 'no callback_url' };
    const env = buildCallback(s, { bet, win, round, serial, ts }); const plain = env._plain; delete env._plain;
    st.calls.push({ serial, env });
    let attempts = 0, last = null, rd;
    const max = 1 + (o.retry || 0);
    while (attempts < max) {
      attempts++;
      try { last = await post(s.callback_url, env, o.timeoutMs); } catch (e) { last = { http: 0, json: null, error: String(e && e.message || e) }; }
      rd = readBalance(last);
      if (rd.ok) break;
      if (attempts < max) await new Promise((r) => setTimeout(r, opts.retryDelayMs));
    }
    if (rd.ok) st.txs.push({ member: s.member, bet, win, currency: s.currency, serial, round, game_uid: s.game_uid, ms: ts });
    return { ok: rd.ok, code: rd.code, msg: rd.msg, balance: rd.balance, serial_number: serial, round, attempts, http: last.http, raw: last.json, plain, mode: 'shared' };
  }
  /** 原样重发同一条回调（模拟 HUIDU 重试：同 serial_number、同密文） */
  async function resend(serial) {
    const c = st.calls.find((x) => x.serial === serial); if (!c) throw new Error('no such call');
    const sess = [...st.sessions.values()].find((s) => s.member === decrypt(c.env.payload, opts.aesKey).member_account);
    const r = await post(sess.callback_url, c.env);
    return Object.assign({ http: r.http, raw: r.json }, readBalance(r));
  }
  /** 把一条交易只写进 HUIDU 的交易记录而不回调运营商（用于对账“本地缺失”场景） */
  function recordSilently(o) { st.txs.push({ member: o.member, bet: Math.round(o.bet * 100), win: Math.round(o.win * 100), currency: o.currency || 'USD', serial: o.serial || crypto.randomUUID(), round: o.round || 'rsilent', game_uid: o.game_uid, ms: o.ts || Date.now() }); }

  // ---- 内置 3 轴演示玩法（模拟器页面 / 演示 iframe 用） ----
  const SYM = ['🍒', '🍋', '🔔', '⭐', '7', '💎'];
  async function spin(sessionId, amount) {
    const reels = [0, 0, 0].map(() => crypto.randomInt(0, SYM.length));
    const mult = reels[0] === reels[1] && reels[1] === reels[2] ? 10 : reels[0] === reels[1] || reels[1] === reels[2] ? 1.5 : 0;
    const win = Math.floor(amount * mult * 100) / 100;
    const r = await play({ session: sessionId, bet: amount, win });
    return Object.assign({ reels: reels.map((i) => SYM[i]), win }, r);
  }

  // ---- HTTP ----
  function readJson(req) {
    return new Promise((resolve, reject) => {
      const ch = []; req.on('data', (c) => ch.push(c)); req.on('error', reject);
      req.on('end', () => { try { const t = Buffer.concat(ch).toString('utf8'); resolve(t ? JSON.parse(t) : {}); } catch (e) { reject(e); } });
    });
  }
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x'); const send = (code, o, type) => { const s = typeof o === 'string' ? o : JSON.stringify(o); res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' }); res.end(s); };
    try {
      if (st.fail.maintenance && url.pathname.startsWith('/game/')) return send(200, bad(10034));
      if (st.fail.hang && url.pathname.startsWith('/game/')) return; // 不响应，模拟超时
      if (req.method === 'GET' && url.pathname === '/game/providers') return send(200, providers(url.searchParams));
      if (req.method === 'GET' && url.pathname === '/game/list') return send(200, gameList(url.searchParams));
      if (req.method === 'POST' && url.pathname.startsWith('/game/')) {
        let body; try { body = await readJson(req); } catch { return send(200, bad(10004)); }
        const o = openEnvelope(body); if (o.err) return send(200, o.err);
        if (url.pathname === '/game/v1') return send(200, launchV1(o.p));
        if (url.pathname === '/game/v2') return send(200, launchV2(o.p));
        if (url.pathname === '/game/transaction/list') return send(200, txList(o.p));
        return send(404, { code: 10022, msg: 'unknown endpoint' });
      }
      if (req.method === 'POST' && url.pathname === '/sim/play') { const b = await readJson(req); const amt = Number(b.amount); if (!(amt > 0)) return send(400, { ok: false, msg: 'amount' }); return send(200, await spin(b.session, amt)); }
      if (req.method === 'GET' && url.pathname === '/sim/game') {
        const s = st.sessions.get(url.searchParams.get('session'));
        return send(s ? 200 : 404, `<!doctype html><meta charset=utf-8><title>HUIDU simulator</title><body style="font-family:sans-serif;background:#150c38;color:#fff;padding:24px"><h3>HUIDU simulator game</h3><p>session ${s ? s.id : 'invalid'} · mode ${st.mode}</p><p>POST /sim/play {"session","amount"}</p>`, 'text/html; charset=utf-8');
      }
      return send(404, { code: 10022, msg: 'not found' });
    } catch (e) { return send(200, bad(10005)); }
  }
  function listen(port, host) {
    return new Promise((resolve, reject) => {
      server = http.createServer(handle); server.on('error', reject);
      server.listen(port || 0, host || '127.0.0.1', () => { baseUrl = `http://${host || '127.0.0.1'}:${server.address().port}`; resolve(baseUrl); });
      server.unref && server.unref();
    });
  }
  const close = () => new Promise((r) => (server ? server.close(() => r()) : r()));
  return {
    listen, close, play, resend, spin, recordSilently,
    get baseUrl() { return baseUrl; }, state: st, agencyUid: opts.agencyUid, aesKey: opts.aesKey, walletMode: opts.walletMode,
    failNext: (kind) => { st.fail[kind] = kind === 'transfer' ? 'status2' : true; }, // transfer: 'status2'|'code10026'
    setFail: (kind, v) => { if (v) st.fail[kind] = v; else delete st.fail[kind]; },
    freeze: (m) => st.frozen.add(m), session: (id) => st.sessions.get(id), playerOf: player,
    setBalance: (m, yuan, currency) => { ensurePlayer(m, currency || 'USD').balance = Math.round(yuan * 100); },
    catalog: cat, ERR,
  };
}

if (require.main === module) {
  const key = process.env.HUIDU_SIM_AES_KEY || crypto.randomBytes(16).toString('hex');
  const uid = process.env.HUIDU_SIM_AGENCY_UID || crypto.randomBytes(16).toString('hex');
  const sim = createSimulator({ agencyUid: uid, aesKey: key, walletMode: process.env.HUIDU_SIM_MODE === 'transfer' ? 'transfer' : 'shared', defaultCallbackUrl: process.env.HUIDU_SIM_CALLBACK_URL || '' });
  sim.listen(Number(process.env.HUIDU_SIM_PORT) || 8090, process.env.HUIDU_SIM_HOST || '127.0.0.1').then((u) => {
    console.log('HUIDU simulator:', u, '| mode =', sim.walletMode);
    console.log('HUIDU_BASE_URL=' + u); console.log('HUIDU_AGENCY_UID=' + uid); console.log('HUIDU_AES_KEY=' + key + '   (仅模拟器用的随机凭据)');
  });
  server_keepalive();
}
function server_keepalive() { setInterval(() => {}, 1 << 30); }
module.exports = { createSimulator, defaultCatalog, ERR };
