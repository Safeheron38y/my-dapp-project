'use strict';
/**
 * HUIDU GameApi 适配器（共享钱包 + 转账钱包，由 providers.json 的 walletMode 选择）。依据 /workspace/gameapi/ANALYSIS.md §3/§4/§8.5。
 *
 * 凭据只来自环境变量（经 providers.json 的 ${VAR} 替换）：
 *   HUIDU_BASE_URL   服务地址（测试/生产分别提供，文档只给过示例）
 *   HUIDU_AGENCY_UID 代理识别码（明文出现在每个请求里，非保密）
 *   HUIDU_AES_KEY    32 个 ASCII 字符的 AES-256 密钥（保密；公开文档里的示例密钥一律视为已泄漏，禁止使用）
 *   HUIDU_CURRENCY   玩家币种（默认 USD；HUIDU 要求同一玩家币种固定，见错误码 10011）
 *   HUIDU_WALLET_MODE shared | transfer（一个代理账号只能用一种，10024）
 * 凭据不全且 HUIDU_SIMULATOR=auto(默认) 时，自动启用本地模拟器 sim/huidu-sim.js（随机生成凭据，离线可测）。
 *
 * 回调（共享钱包）：HUIDU 只有一个回调 URL，不含 action：POST /provider/<name>/callback，
 *   信封 {agency_uid,timestamp,payload}，payload=AES({serial_number,currency_code,game_uid,member_account,win_amount,bet_amount,timestamp,game_round,data?})
 *   → 统一映射为钱包核心的 settle（bet+win 一条账本，负数=退款，serial_number 幂等）。
 *   响应：HTTP 恒 200，{code:0|1,msg,payload:AES({credit_amount,timestamp})}，成功/失败都返回当前余额。
 */
const Base = require('./_template');
const crypto = require('crypto');
const config = require('../lib/config');
const store = require('../lib/store');
const wallet = require('../lib/wallet');
const alias = require('../lib/alias');
const { toMinor } = require('../lib/money');
const hc = require('../lib/huidu-crypto');
const { WalletError } = wallet;

// 文档错误码 → 平台错误（http 为对玩家端 API 的状态码）
const ERR_MAP = {
  10002: ['PROVIDER_AUTH_FAILED', 502], 10004: ['PROVIDER_PAYLOAD_ERROR', 502], 10005: ['PROVIDER_ERROR', 502],
  10008: ['GAME_NOT_FOUND', 404], 10011: ['CURRENCY_MISMATCH', 409], 10012: ['PLAYER_EXISTS', 409], 10013: ['CURRENCY_NOT_SUPPORTED', 400],
  10014: ['PLAYER_NAME_INVALID', 400], 10015: ['PLAYER_NAME_INVALID', 400], 10016: ['ACCOUNT_FROZEN', 403], 10017: ['PROVIDER_VENDOR_NOT_FOUND', 404],
  10018: ['CURRENCY_NOT_SUPPORTED', 400], 10020: ['PROVIDER_NOT_CONFIGURED', 503], 10022: ['PROVIDER_BAD_PARAMS', 502], 10023: ['PLAYER_NAME_INVALID', 400],
  10024: ['WALLET_MODE_MISMATCH', 409], 10025: ['INSUFFICIENT_FUNDS', 402], 10026: ['TRANSFER_FAILED', 502], 10027: ['TRANSFER_EXISTS', 409],
  10028: ['PROVIDER_BAD_PARAMS', 400], 10029: ['PROVIDER_BAD_PARAMS', 400], 10030: ['PROVIDER_RATE_LIMITED', 429], 10031: ['PROVIDER_BAD_PARAMS', 400],
  10032: ['PROVIDER_BAD_PARAMS', 400], 10033: ['PROVIDER_BAD_PARAMS', 400], 10034: ['PROVIDER_MAINTENANCE', 503],
};
const fmt = (minor) => (minor / 100).toFixed(2);
const DAY = 86400000;

function parseAmount(v) { // 带符号的“元”字符串/数字 → 带符号整数分；非法返回 null
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  const m = /^\s*(-?)(\d+)(?:\.(\d+))?\s*$/.exec(v);
  if (!m) return null;
  const frac = m[3] || '';
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return null; // 超过 2 位有效小数
  const minor = toMinor(`${m[2]}.${(frac + '00').slice(0, 2)}`);
  if (minor == null) return null;
  return m[1] ? -minor : minor;
}
function parseTs(v) { // 兼容毫秒字符串/数字 与 "yyyy-MM-dd HH:mm:ss"(UTC+0)（文档 EN/CN 自相矛盾）
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  if (/^\d{10,13}$/.test(v)) return v.length <= 10 ? Number(v) * 1000 : Number(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(v);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}
function mapType(t) {
  const s = String(t || '').toLowerCase();
  if (/fish|捕鱼|釣魚/.test(s)) return 'fishing';
  if (/live|真人|casino ?live/.test(s)) return 'live';
  if (/sport|体育|esport|virtual/.test(s)) return 'sports';
  if (/crash|instant|mini|arcade|lottery|彩票|dice|plinko|mines/.test(s)) return 'crash';
  if (/card|table|poker|棋牌|board|mahjong|rummy/.test(s)) return 'table';
  return 'slots';
}
const safeEq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };

class HuiduAdapter extends Base {
  constructor(cfg, name) {
    super(cfg, name);
    const mode = String(cfg.simulator || 'auto').toLowerCase();
    const complete = !!(cfg.baseUrl && cfg.apiKey && cfg.secret);
    this.useSim = mode === 'on' || (mode === 'auto' && !complete);
    this.pending = new Map(); // transfer_id -> 状态未知的转账（超时），需人工/对账处理
    this.sim = null; this._simP = null; this.configError = null;
    if (this.useSim) {
      this.agencyUid = crypto.randomBytes(16).toString('hex');
      this.aesKey = crypto.randomBytes(16).toString('hex'); // 运行期随机，仅内置模拟器使用
      this.baseUrl = '';
    } else {
      this.agencyUid = cfg.apiKey || ''; this.aesKey = cfg.secret || ''; this.baseUrl = String(cfg.baseUrl || '').replace(/\/+$/, '');
      if (!complete) this.configError = '缺少 HUIDU_BASE_URL / HUIDU_AGENCY_UID / HUIDU_AES_KEY';
      else if (!hc.validKey(this.aesKey)) this.configError = 'HUIDU_AES_KEY 必须正好 32 个 ASCII 字符(32 字节)';
      if (this.configError) console.warn(`[adapter:${name}] ${this.configError}（可设 HUIDU_SIMULATOR=on 使用本地模拟器）`);
    }
    this.tolSec = cfg.tsToleranceSec != null && cfg.tsToleranceSec !== '' ? Number(cfg.tsToleranceSec) : 86400;
    this.timeoutMs = Number(cfg.timeoutMs) || 10000;
    this._gameIdx = null;
  }
  get walletMode() { return this.cfg.walletMode === 'transfer' ? 'transfer' : 'shared'; }
  get currency() { return String(this.cfg.currency || 'USD').toUpperCase(); }
  isDemo() { return this.useSim; }
  /** 'simulator' | 'live' | 'misconfigured'（不含任何密钥） */
  get modeLabel() { return this.useSim ? 'simulator' : this.configError ? 'misconfigured' : 'live'; }

  // ---------- 连接 ----------
  async ensureReady() {
    if (this.configError) throw new WalletError('PROVIDER_NOT_CONFIGURED', '供应商未配置：' + this.configError, 503);
    if (this.useSim && !this.sim) {
      if (!this._simP) {
        this._simP = (async () => {
          const { createSimulator } = require('../sim/huidu-sim');
          const s = createSimulator({ agencyUid: this.agencyUid, aesKey: this.aesKey, walletMode: this.walletMode });
          this.baseUrl = await s.listen(0, '127.0.0.1'); this.sim = s;
        })();
      }
      await this._simP;
    }
  }
  /** 加密请求 → 解析响应；payload 兼容对象/加密串。网络异常/超时统一抛 PROVIDER_TIMEOUT（状态未知） */
  async _post(pathName, body) {
    await this.ensureReady();
    const ts = String(Date.now());
    const env = { agency_uid: this.agencyUid, timestamp: ts, payload: hc.encrypt(Object.assign({ agency_uid: this.agencyUid, timestamp: ts }, body), this.aesKey) };
    return this._fetch(pathName, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env) });
  }
  async _get(pathName, params) {
    await this.ensureReady();
    const q = new URLSearchParams(Object.assign({ agency_uid: this.agencyUid }, params));
    return this._fetch(pathName + '?' + q, { method: 'GET' });
  }
  async _fetch(pathAndQuery, init) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    let r, txt;
    try { r = await fetch(this.baseUrl + pathAndQuery, Object.assign({ signal: ctl.signal }, init)); txt = await r.text(); }
    catch (e) { throw new WalletError('PROVIDER_TIMEOUT', '供应商请求超时或网络错误（结果未知）', 504, { unknown: true }); }
    finally { clearTimeout(t); }
    let j; try { j = JSON.parse(txt); } catch { throw new WalletError('PROVIDER_BAD_RESPONSE', '供应商返回了非 JSON 响应', 502); }
    const code = Number(j.code);
    if (code !== 0) { const m = ERR_MAP[code] || ['PROVIDER_ERROR', 502]; throw new WalletError(m[0], `供应商错误 ${code}: ${j.msg || ''}`, m[1], { providerCode: code }); }
    let payload = j.payload;
    if (typeof payload === 'string') { try { payload = hc.decrypt(payload, this.aesKey); } catch { throw new WalletError('PROVIDER_BAD_RESPONSE', '无法解密供应商响应', 502); } }
    return { payload: payload, data: j.data, raw: j };
  }

  // ---------- 启动游戏 ----------
  _homeUrl(u) { if (!u) return undefined; let s = String(u).split('#')[0]; if (s.includes('?')) s = s.split('?')[0]; return s || undefined; } // 10033: 不得含 ?
  _lang(l) { const s = String(l || 'en').toLowerCase().split(/[-_]/)[0]; return /^[a-z]{2}$/.test(s) ? s : 'en'; }
  _common(ctx, member) {
    return { member_account: member, currency_code: this.currency, language: this._lang(ctx.lang), home_url: this._homeUrl(ctx.returnUrl), platform: ctx.device === 'mobile' ? '2' : '1' };
  }
  _rewrite(url, ctx) { // 模拟器模式：游戏页由本平台同源页面承载（浏览器访问不到 127.0.0.1 的模拟器）
    const sid = new URL(url).searchParams.get('session');
    const q = new URLSearchParams({ session: sid, provider: this.name, game: ctx.game.id, mode: this.walletMode, lang: ctx.lang || 'zh-CN' });
    return `${ctx.publicBase || ''}/demo/huidu-game.html?${q}`;
  }
  async launch(ctx) {
    await this.ensureReady();
    const member = alias.aliasFor(this.name, ctx.user.id, this.cfg.aliasPrefix);
    const g = ctx.game; const uid = g.providerGameId;
    if (!uid) throw new WalletError('GAME_NOT_FOUND', '游戏缺少 providerGameId(HUIDU game_uid)', 404);
    let url, extra = {};
    if (this.walletMode === 'shared') {
      const body = Object.assign(this._common(ctx, member), { game_uid: uid, credit_amount: fmt(ctx.user.balance), callback_url: this.cfg.callbackUrl || `${ctx.callbackBase}/callback` });
      if (g.extras) body.extras = g.extras;
      url = (await this._post('/game/v1', body)).payload.game_launch_url;
    } else {
      const amt = this._autoAmount(ctx);
      const r = await this._transfer(ctx.user, member, amt, { game_uid: uid, ctx });
      url = r.payload.game_launch_url; extra = { providerBalance: Number(r.payload.after_amount), transferred: amt / 100 };
    }
    if (!url) throw new WalletError('PROVIDER_BAD_RESPONSE', '供应商未返回 game_launch_url', 502);
    return Object.assign({ url: this.useSim ? this._rewrite(url, ctx) : url, method: 'GET', mode: this.useSim ? 'demo' : 'real', expiresIn: null }, extra);
  }
  _autoAmount(ctx) {
    if (ctx.transferAmountMinor != null) return Math.min(ctx.transferAmountMinor, ctx.user.balance);
    const a = String(this.cfg.autoTransfer == null ? 'all' : this.cfg.autoTransfer).toLowerCase();
    if (a === 'none' || a === '0') return 0;
    if (a === 'all' || a === '') return ctx.user.balance;
    const m = toMinor(Number(a)); return m == null ? 0 : Math.min(m, ctx.user.balance);
  }

  // ---------- 转账钱包（/game/v2） ----------
  /** 本地先扣 → 调 v2 → 明确失败则本地冲回；超时(未知)则保留并登记 pending */
  async _transfer(user, member, amountMinor, opt) {
    opt = opt || {};
    const txId = opt.txId || 'hl' + crypto.randomBytes(10).toString('hex');
    const common = opt.ctx ? this._common(opt.ctx, member) : { member_account: member, currency_code: this.currency };
    const body = Object.assign(common, { transfer_id: txId, credit_amount: fmt(amountMinor) }, opt.game_uid ? { game_uid: opt.game_uid } : {});
    if (amountMinor > 0) wallet.transfer({ provider: this.name, userId: user.id, direction: 'in', amountMinor, txId, external: true });
    let r;
    try { r = await this._post('/game/v2', body); }
    catch (e) {
      if (amountMinor > 0) {
        if (e.extra && e.extra.unknown) this.pending.set(txId, { userId: user.id, amountMinor, dir: 'in', at: Date.now() });
        else wallet.transfer({ provider: this.name, userId: user.id, direction: 'out', amountMinor, txId: txId + '-rev', external: true });
      }
      throw e;
    }
    if (Number(r.payload.transfer_status) === 2) {
      if (amountMinor > 0) wallet.transfer({ provider: this.name, userId: user.id, direction: 'out', amountMinor, txId: txId + '-rev', external: true });
      throw new WalletError('TRANSFER_FAILED', '供应商转账失败 (transfer_status=2)', 502, { providerCode: 10026 });
    }
    return r;
  }
  _member(user) { return alias.aliasFor(this.name, user.id, this.cfg.aliasPrefix); }
  async queryBalance({ user }) {
    const r = await this._post('/game/v2', { member_account: this._member(user), currency_code: this.currency, transfer_id: 'hq' + crypto.randomBytes(10).toString('hex'), credit_amount: '0' });
    return { amountMinor: parseAmount(String(r.payload.after_amount)) || 0 };
  }
  async transferIn({ user, amountMinor, txId }) {
    if (this.walletMode !== 'transfer') throw new WalletError('WALLET_MODE_MISMATCH', '该供应商为共享钱包模式', 409);
    const dup = store.ledger.get(`${this.name}:${txId}`);
    if (dup) { const v = wallet.transfer({ provider: this.name, userId: user.id, direction: 'in', amountMinor, txId, external: true }); return { providerBalance: v.providerBalance, duplicate: true }; }
    const r = await this._transfer(user, this._member(user), amountMinor, { txId });
    return { providerBalance: Number(r.payload.after_amount) };
  }
  async transferOut({ user, amountMinor, txId }) {
    if (this.walletMode !== 'transfer') throw new WalletError('WALLET_MODE_MISMATCH', '该供应商为共享钱包模式', 409);
    const dup = store.ledger.get(`${this.name}:${txId}`);
    if (dup) return { amountMinor: dup.amount, duplicate: true };
    const member = this._member(user);
    const have = (await this.queryBalance({ user })).amountMinor;
    const amt = amountMinor == null ? have : amountMinor;
    if (amt > have) throw new WalletError('INSUFFICIENT_FUNDS', '供应商钱包余额不足', 402);
    if (amt <= 0) return { amountMinor: 0 };
    let r;
    try { r = await this._post('/game/v2', { member_account: member, currency_code: this.currency, transfer_id: txId, credit_amount: '-' + fmt(amt) }); }
    catch (e) { if (e.extra && e.extra.unknown) this.pending.set(txId, { userId: user.id, amountMinor: amt, dir: 'out', at: Date.now() }); throw e; }
    if (Number(r.payload.transfer_status) === 2) throw new WalletError('TRANSFER_FAILED', '供应商转账失败 (transfer_status=2)', 502, { providerCode: 10026 });
    wallet.transfer({ provider: this.name, userId: user.id, direction: 'out', amountMinor: amt, txId, external: true });
    return { amountMinor: amt };
  }
  pendingTransfers() { return [...this.pending.entries()].map(([id, v]) => Object.assign({ transferId: id }, v)); }

  // ---------- 回调（共享钱包） ----------
  decodeCallback(req) {
    const env = req.body;
    if (!env || typeof env !== 'object' || typeof env.payload !== 'string') return { ok: false, reason: 'payload error' };
    if (this.configError || !hc.validKey(this.aesKey)) return { ok: false, reason: 'provider not configured' };
    try { return { ok: true, body: hc.decrypt(env.payload, this.aesKey), envelope: env }; }
    catch { return { ok: false, reason: 'payload error' }; }
  }
  /** 验签 = 解密成功(由 decodeCallback 完成) + agency_uid 一致 + payload.timestamp 在窗口内（窗口见 HUIDU_TS_TOLERANCE_SEC；0=不校验） */
  verifyCallback(req) {
    const env = req.envelope || {};
    if (!env.agency_uid || !safeEq(env.agency_uid, this.agencyUid)) return { ok: false, reason: 'agency error' };
    if (this.tolSec > 0) {
      const ts = parseTs(req.body && req.body.timestamp);
      if (!Number.isFinite(ts)) return { ok: false, reason: 'timestamp invalid' };
      if (Math.abs(Date.now() - ts) > this.tolSec * 1000) return { ok: false, reason: 'timestamp out of range' };
    }
    return { ok: true };
  }
  resolveAction() { return 'settle'; }
  _games() {
    if (!this._gameIdx || this._gameIdxN !== config.catalog.games.length) {
      this._gameIdx = new Map(); this._gameIdxN = config.catalog.games.length;
      for (const g of config.catalog.games) if (g.provider === this.name && g.providerGameId) this._gameIdx.set(g.providerGameId, g);
    }
    return this._gameIdx;
  }
  get callbackActions() { return ['settle']; } // 只有一个回调（POST /provider/<name>/callback）
  parseCallback(action, req, info) {
    const b = req.body || {};
    if (typeof b.member_account !== 'string' || !b.member_account) throw new WalletError('INVALID_PARAMS', '缺少或非法字段 member_account', 400);
    const userId = alias.resolve(this.name, b.member_account, this.cfg.aliasPrefix);
    if (info && userId) info.userId = userId; // 先定位玩家：后续任何校验失败都能返回其余额（文档：无论成功失败均需返回余额）
    for (const k of ['serial_number', 'game_uid', 'game_round', 'currency_code']) if (typeof b[k] !== 'string' || !b[k]) throw new WalletError('INVALID_PARAMS', `缺少或非法字段 ${k}`, 400);
    if (String(b.currency_code).toUpperCase() !== this.currency) throw new WalletError('CURRENCY_MISMATCH', '币种不匹配', 409);
    const bet = parseAmount(b.bet_amount), win = parseAmount(b.win_amount);
    if (bet == null || win == null) throw new WalletError('INVALID_AMOUNT', 'bet_amount / win_amount 非法（带符号，最多两位小数）', 400);
    if (!userId) throw new WalletError('PLAYER_NOT_FOUND', '玩家不存在', 404);
    const g = this._games().get(b.game_uid);
    return { userId, txId: b.serial_number, betMinor: bet, winMinor: win, roundId: b.game_round, gameId: g ? g.id : b.game_uid, category: g ? g.category : undefined };
  }
  _body(code, msg, balanceMajor) {
    const b = { code, msg: msg || '' };
    if (balanceMajor != null) b.payload = hc.encrypt({ credit_amount: Number(balanceMajor).toFixed(2), timestamp: String(Date.now()) }, this.aesKey);
    return { status: 200, body: b };
  }
  formatResponse(action, result) { return this._body(0, '', result.balance); }
  /** 失败也要返回玩家余额（info.balance，主币单位）；玩家未知时返回 0.00 */
  formatError(action, err, info) {
    const bal = info && info.balance != null ? info.balance : 0;
    return this._body(1, String(err.code || 'ERROR'), bal);
  }
  formatDecodeError(reason) { return { status: 200, body: { code: 1, msg: reason || 'payload error' } }; }
  formatAuthError(reason) { return { status: 200, body: { code: 1, msg: reason || 'auth error' } }; }

  // ---------- 目录同步 ----------
  async listProviders(q) { return (await this._get('/game/providers', q || {})).data || []; }
  async listProviderGames(code, q) { return (await this._get('/game/list', Object.assign({ code }, q || {}))).data || []; }
  /** 拉取全部在线厂商 → 游戏（status=0 的厂商/游戏、名称标注下架/暂停/维护的厂商一律不入库） */
  async listGames() {
    const provs = (await this.listProviders()).filter((p) => Number(p.status) === 1 && !/下架|暂停|维护|永久|retired|deprecated/i.test(p.name || ''));
    const out = [], skipped = [];
    for (const p of provs) {
      for (const x of await this.listProviderGames(p.code)) {
        if (Number(x.status) !== 1) { skipped.push(x.game_uid); continue; }
        const category = mapType(x.game_type);
        out.push({ id: `hd-${p.code}-${String(x.game_uid).slice(0, 8)}`, name: x.game_name, category, subcategory: category === 'fishing' ? 'fishing' : (String(x.game_type || '').toLowerCase().replace(/[^a-z0-9]+/g, '') || category), provider: this.name, type: 'iframe', orientation: 'any', tags: [], demo: false, providerGameId: x.game_uid, vendor: p.name, rawType: x.game_type });
      }
    }
    this.lastSkipped = skipped;
    return out;
  }
  /** 与当前目录对比。apply:true 时把新增游戏并入、把远端已下架(status=0)的从内存目录移除。 */
  async syncCatalog({ apply } = {}) {
    const remote = await this.listGames();
    const remoteIds = new Set(remote.map((g) => g.providerGameId));
    const mine = config.catalog.games.filter((g) => g.provider === this.name && g.providerGameId);
    const mineIds = new Set(mine.map((g) => g.providerGameId));
    const added = remote.filter((g) => !mineIds.has(g.providerGameId));
    const retired = mine.filter((g) => !remoteIds.has(g.providerGameId));
    if (apply) {
      config.catalog.games.push(...added);
      const dead = new Set(retired.map((g) => g.id));
      config.catalog.games = config.catalog.games.filter((g) => !dead.has(g.id));
      this._gameIdx = null;
    }
    return { remote: remote.length, added, retired, unchanged: mine.length - retired.length };
  }

  // ---------- 对账 ----------
  /** 拉取某个 UTC 日的 /game/transaction/list（同一天、最近 60 天、≤5000/页），与本地账本按 serial_number 比对 */
  async reconcile({ date, pageSize } = {}) {
    const d = typeof date === 'number' ? date : Date.parse(String(date || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
    if (!Number.isFinite(d)) throw new WalletError('INVALID_PARAMS', 'date 非法');
    const from = Math.floor(d / DAY) * DAY, to = from + DAY - 1;
    const ps = Math.min(Math.max(pageSize || 1000, 1), 5000);
    const remote = []; let page = 1, total = 0;
    for (;;) {
      const r = (await this._post('/game/transaction/list', { from_date: from, to_date: to, page_no: page, page_size: ps })).payload;
      total = Number(r.total_count) || 0; remote.push(...(r.records || []));
      if (remote.length >= total || !(r.records || []).length) break;
      page++;
    }
    const localMap = new Map();
    for (const e of store.ledger.values()) if (e.provider === this.name && e.type === 'settle' && e.createdAt >= from && e.createdAt <= to) localMap.set(e.txId, e);
    const remoteIds = new Set(), missingLocal = [], mismatched = []; let matched = 0;
    for (const r of remote) {
      remoteIds.add(r.serial_number);
      const l = localMap.get(r.serial_number);
      if (!l) { missingLocal.push(r); continue; }
      const rb = parseAmount(r.bet_amount), rw = parseAmount(r.win_amount);
      if (rb !== l.bet || rw !== l.win) mismatched.push({ serial_number: r.serial_number, remote: { bet: r.bet_amount, win: r.win_amount }, local: { bet: fmt(l.bet), win: fmt(l.win) } });
      else matched++;
    }
    const missingRemote = [...localMap.values()].filter((e) => !remoteIds.has(e.txId)).map((e) => ({ serial_number: e.txId, bet: fmt(e.bet), win: fmt(e.win) }));
    return { date: new Date(from).toISOString().slice(0, 10), remoteTotal: total, localTotal: localMap.size, matched, missingLocal, missingRemote, mismatched, ok: !missingLocal.length && !missingRemote.length && !mismatched.length };
  }

  // ---------- 仅模拟器模式的演示玩法 ----------
  async simPlay(sessionId, amount) {
    await this.ensureReady();
    if (!this.sim) throw new WalletError('NOT_SIMULATOR', '非模拟器模式', 400);
    return this.sim.spin(sessionId, amount);
  }
}
HuiduAdapter.helpers = { parseAmount, parseTs, mapType };
module.exports = HuiduAdapter;
