/**
 * 8K API 客户端：统一封装 fetch、鉴权、错误、幂等键、钱包状态订阅。
 * 接入真实后端时只需改 BASE（或同域部署），页面代码不用动。
 * 语法保持在 ES2017 范围（无 ?. / ??），以兼容较旧的移动浏览器。
 */
var BASE = (window.__8K_API_BASE__ || '').replace(/\/$/, '');
var LS = (function () { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return localStorage; } catch (e) { var m = {}; return { getItem: function (k) { return m[k] || null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; } })();

export function store(k, v) { if (v === undefined) return LS.getItem('8k.' + k); if (v === null) LS.removeItem('8k.' + k); else LS.setItem('8k.' + k, v); }

export class ApiError extends Error {
  constructor(status, body) { super((body && body.message) || ('HTTP ' + status)); this.status = status; this.code = (body && body.code) || 'ERROR'; this.body = body || {}; }
}

var listeners = [];
export var state = { token: store('token'), user: null, wallet: null, region: store('region') || 'default' };
export function onWallet(fn) { listeners.push(fn); if (state.wallet) fn(state.wallet); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }
function emit() { listeners.forEach(function (f) { try { f(state.wallet, state.user); } catch (e) { console.error(e); } }); }
export function setBalance(b) { if (!state.wallet) state.wallet = { currency: 'DEMO' }; state.wallet.balance = b; emit(); }

export function uuid() {
  var a = new Uint8Array(12);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
}

export function request(method, path, body, opt) {
  opt = opt || {};
  var headers = { 'Accept': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  if (state.region && state.region !== 'default') headers['X-Region'] = state.region;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opt.idempotencyKey) headers['Idempotency-Key'] = opt.idempotencyKey;
  var ctl = window.AbortController ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, opt.timeout || 15000);
  return fetch(BASE + path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { clearTimeout(timer); if (!r.ok) throw new ApiError(r.status, j); return j; }); })
    .catch(function (e) {
      clearTimeout(timer);
      if (e instanceof ApiError) throw e;
      var err = new ApiError(0, { code: 'NETWORK', message: '网络连接失败，请检查网络后重试' });
      throw err;
    });
}
// 带自动重试：仅用于 GET 或带幂等键的 POST（安全）
export function retrying(fn, n) {
  n = n == null ? 2 : n;
  return fn().catch(function (e) { if (n > 0 && e.code === 'NETWORK') return new Promise(function (r) { setTimeout(r, 600); }).then(function () { return retrying(fn, n - 1); }); throw e; });
}

function applyWallet(w, user) { if (w) state.wallet = w; if (user) state.user = user; emit(); }

export var api = {
  config: function () { return request('GET', '/api/config?region=' + encodeURIComponent(state.region)); },
  login: function (username, region) {
    return request('POST', '/api/auth/login', { username: username, region: region || state.region }).then(function (r) {
      state.token = r.token; store('token', r.token); store('username', username);
      if (region) { state.region = region; store('region', region); }
      applyWallet(r.wallet, r.user); return r;
    });
  },
  // 演示环境：没有令牌时自动以访客身份登录，方便直接体验
  ensure: function () {
    var go = function () { var n = store('username') || ('演示玩家' + uuid().slice(0, 4)); return api.login(n); };
    if (!state.token) return go();
    return request('GET', '/api/me').then(function (r) { if (r.user.region !== state.region) { state.region = r.user.region; store('region', state.region); } applyWallet(r.wallet, r.user); return r; })
      .catch(function (e) { if (e.status === 401) return go(); throw e; });
  },
  logout: function () { var p = state.token ? request('POST', '/api/auth/logout', {}).catch(function () {}) : Promise.resolve(); return p.then(function () { state.token = null; store('token', null); state.user = null; state.wallet = null; emit(); }); },
  wallet: function () { return request('GET', '/api/wallet').then(function (w) { applyWallet(w); return w; }); },
  deposit: function (amount) { return request('POST', '/api/wallet/deposit', { amount: amount }, { idempotencyKey: uuid() }).then(function (r) { setBalance(r.balance); return r; }); },
  transactions: function (limit) { return request('GET', '/api/transactions?limit=' + (limit || 20)); },
  games: function (params) {
    var q = Object.keys(params || {}).filter(function (k) { return params[k]; }).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return retrying(function () { return request('GET', '/api/games?region=' + encodeURIComponent(state.region) + (q ? '&' + q : '')); });
  },
  launch: function (id, extra) { return request('POST', '/api/games/' + encodeURIComponent(id) + '/launch', Object.assign({ device: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop', lang: 'zh-CN', returnUrl: location.origin + '/' }, extra || {})); },
  // 以下均为带幂等键的下注类请求：同一 key 重放不会重复扣款
  bet: function (path, body, key) { return request('POST', path, body, { idempotencyKey: key || uuid() }).then(function (r) { if (typeof r.balance === 'number') setBalance(r.balance); return r; }); },
  liveBet: function (game, gameId, bets, key) { return api.bet('/api/live/' + game + '/bet', { gameId: gameId, bets: bets }, key); },
  sportsEvents: function (sport) { return request('GET', '/api/sports/events' + (sport ? '?sport=' + sport : '')); },
  sportsBet: function (payload, key) { return api.bet('/api/sports/bets', payload, key); },
  sportsBets: function () { return request('GET', '/api/sports/bets'); },
  sportsSettle: function (id, result) { return request('POST', '/api/sports/bets/' + id + '/settle', { result: result }).then(function (r) { setBalance(r.balance); return r; }); },
  inhouse: function (game, action, body, key) { return api.bet('/api/inhouse/' + game + '/' + action, body || {}, key); },
  get: function (p) { return request('GET', p); },
  post: function (p, b, o) { return request('POST', p, b, o); },
};

/* 金额格式化(1,234.50)。不用 Intl/toLocaleString：首次调用要初始化 ICU，4x 降速下实测约 170ms 主线程阻塞。 */
export function fmt(n) {
  var x = Number(n); if (x !== x) return 'NaN';
  var s = Math.abs(x).toFixed(2); if (s.length > 40) return String(x);
  var p = s.split('.'), neg = x < 0 && s !== '0.00';
  return (neg ? '-' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + p[1];
}
export function errText(e) {
  var m = { INSUFFICIENT_FUNDS: '余额不足，请先充值（演示币）', ABOVE_MAX_BET: '超过单笔最高投注', BELOW_MIN_BET: '低于最低投注', CATEGORY_DISABLED: '您所在地区暂未开放该品类', SELF_EXCLUDED: '账户处于自我排除期', COOL_OFF: '账户处于冷静期', NETWORK: '网络连接失败，请重试', UNAUTHORIZED: '登录已过期，请刷新页面', ODDS_CHANGED: '赔率已变动，请确认', ROUND_ACTIVE: '已有进行中的回合' };
  return m[e.code] ? m[e.code] + (e.body && e.body.maxBet ? '（' + e.body.maxBet + '）' : e.body && e.body.minBet ? '（' + e.body.minBet + '）' : '') : (e.message || '请求失败');
}
