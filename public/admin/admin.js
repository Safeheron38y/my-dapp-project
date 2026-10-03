/* 8K 后台管理 SPA（无构建、无依赖）。所有数据来自 /api/admin/*；会话为 HttpOnly Cookie，写操作带 X-CSRF-Token。 */
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(n) { var x = Number(n); if (!isFinite(x)) return '-'; var p = Math.abs(x).toFixed(2).split('.'); return (x < 0 && Math.abs(x) >= 0.005 ? '-' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + p[1]; }
function sgn(n) { return (n > 0 ? '+' : '') + fmt(n); }
function cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function fdt(t) { if (!t) return '—'; var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function qs(o) { return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }

var TYPE = { settle: '结算', bet: '投注', win: '派彩', rollback: '冲正', refund: '退款', deposit: '充值(演示)', transfer_in: '转入', transfer_out: '转出', adjust: '运营调整' };
var STATUS = { ok: ['成功', 'ok'], rolled_back: ['已冲正', 'warn'], cancelled: ['已取消', 'off'] };
var MODE = { simulator: ['模拟器', 'vio'], live: ['真实对接', 'ok'], mock: ['演示 Mock', 'vio'], disabled: ['未启用', 'off'], placeholder: ['占位', 'off'] };
var ACTION = { login: '登录后台', login_failed: '登录失败', change_password: '修改管理员密码', adjust_balance: '调整余额', freeze_player: '冻结玩家', unfreeze_player: '解冻玩家', reset_player_password: '重置玩家密码', game_update: '更新游戏', games_bulk: '批量更新游戏', update_settings: '更新设置' };
var CAT = {};

var csrf = '', adminName = '', seq = 0;
var ICON = {
  dashboard: '<path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z"/>',
  players: '<path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6v1H4v-1z"/>',
  games: '<path d="M7 8h10a5 5 0 0 1 4.9 6l-.6 3a3 3 0 0 1-5.3 1.2L15 17H9l-1 1.2A3 3 0 0 1 2.7 17l-.6-3A5 5 0 0 1 7 8zm1 2v1.5H6.5V13H8v1.5h1.5V13H11v-1.5H9.5V10H8zm8.5 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>',
  providers: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3H4V6zm0 5h16v3H4v-3zm0 5h16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2zM7 7.5a1 1 0 1 0 0 .01zM7 12.5a1 1 0 1 0 0 .01zM7 17.5a1 1 0 1 0 0 .01z"/>',
  transactions: '<path d="M5 3h14a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1zm3 5v2h8V8H8zm0 4v2h8v-2H8z"/>',
  settings: '<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm8.4 5.1l-1.8-.4c-.1-.4-.3-.8-.5-1.1l1-1.5-1.8-1.8-1.5 1c-.4-.2-.7-.4-1.1-.5L13.3 7h-2.6l-.4 1.8c-.4.1-.8.3-1.100.5l-1.500-1-1.800 1.800 1 1.500c-.2.400-.4.700-.5 1.100l-1.800.4v2.600l1.800.4c.1.400.3.800.5 1.100l-1 1.500 1.800 1.800 1.500-1c.400.200.700.400 1.100.500l.4 1.800h2.600l.4-1.800c.4-.1.8-.3 1.100-.5l1.500 1 1.800-1.800-1-1.500c.2-.4.4-.7.5-1.100l1.800-.4v-2.600z"/>',
  menu: '<path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/>'
};
function ico(n) { return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + ICON[n] + '</svg>'; }
var NAV = [['dashboard', '仪表盘'], ['players', '玩家管理'], ['games', '游戏管理'], ['providers', '供应商状态'], ['transactions', '交易查询'], ['settings', '系统设置']];

// ---------- 基础设施 ----------
function call(method, path, body) {
  var h = { Accept: 'application/json' };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (method === 'POST' && csrf) h['X-CSRF-Token'] = csrf;
  return fetch(path, { method: method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.message || ('HTTP ' + r.status)); e.status = r.status; e.code = j.code; e.body = j; if (r.status === 401 && j.code === 'ADMIN_UNAUTHORIZED') { csrf = ''; showLogin('登录已过期，请重新登录'); } throw e; }
      return j;
    }); }, function () { var e = new Error('网络连接失败，请稍后重试'); e.status = 0; throw e; });
}
function toast(msg, isErr) {
  var el = document.createElement('div'); el.className = 'toast' + (isErr ? ' err' : ''); el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, isErr ? 5000 : 2600);
}
function fail(e) { toast(e.message || '操作失败', true); }
// 通用对话框：fields=[{name,label,type,value,placeholder,options}]；返回 Promise<values|null>
function dialog(title, intro, fields, okText, danger) {
  return new Promise(function (resolve) {
    var m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', title);
    m.innerHTML = '<form class="box" novalidate><h3>' + esc(title) + '</h3><p class="hint">' + intro + '</p><div class="f-grid" style="grid-template-columns:1fr;margin-top:12px">' +
      fields.map(function (f, i) { return '<div><label class="lbl" for="dlg' + i + '">' + esc(f.label) + '</label>' + (f.type === 'textarea' ? '<textarea class="fld" id="dlg' + i + '" name="' + f.name + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>' : '<input class="fld" id="dlg' + i + '" name="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(f.value || '') + '" placeholder="' + esc(f.placeholder || '') + '" autocomplete="off"' + (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') + '>') + '</div>'; }).join('') +
      '</div><p class="err" id="dlgE"></p><div class="row-b"><button type="button" class="ab ghost" data-x>取消</button><button type="submit" class="ab ' + (danger ? 'danger' : 'pri') + '">' + esc(okText || '确定') + '</button></div></form>';
    document.body.appendChild(m);
    var first = $('input,textarea', m); if (first) setTimeout(function () { first.focus(); }, 30);
    function close(v) { if (m.parentNode) m.parentNode.removeChild(m); document.removeEventListener('keydown', esc_); resolve(v); }
    function esc_(e) { if (e.key === 'Escape') close(null); }
    document.addEventListener('keydown', esc_);
    m.addEventListener('click', function (e) { if (e.target === m || e.target.hasAttribute('data-x')) close(null); });
    $('form', m).addEventListener('submit', function (e) {
      e.preventDefault(); var v = {}; fields.forEach(function (f) { v[f.name] = $('[name=' + f.name + ']', m).value.trim(); });
      if (fields.some(function (f) { return f.required && !v[f.name]; })) { $('#dlgE', m).textContent = '请填写必填项'; return; }
      close(v);
    });
  });
}
function pager(total, page, limit) {
  var pages = Math.max(1, Math.ceil(total / limit));
  return '<div class="pager"><button class="ab ghost sm" data-pg="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>上一页</button><span>第 ' + page + ' / ' + pages + ' 页 · 共 ' + total + ' 条</span><button class="ab ghost sm" data-pg="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>下一页</button></div>';
}
function onPager(root, fn) { root.addEventListener('click', function (e) { var b = e.target.closest('[data-pg]'); if (b && !b.disabled) fn(+b.getAttribute('data-pg')); }); }
function table(cols, rows, empty) {
  if (!rows.length) return '<div class="empty-s">' + (empty || '暂无数据') + '</div>';
  return '<div class="tw"><table class="tbl"><thead><tr>' + cols.map(function (c) { return '<th' + (c.r ? ' class="r"' : '') + '>' + esc(c.h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td data-l="' + esc(c.h) + '"' + (c.cls || c.r ? ' class="' + (c.cls || '') + (c.r ? ' r' : '') + '"' : '') + '>' + c.f(r) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
}
function badge(t, k) { return '<span class="badge ' + k + '">' + esc(t) + '</span>'; }
function sw(attrs, on, label) { return '<label class="sw" ' + (label ? 'title="' + esc(label) + '"' : '') + '><input type="checkbox" role="switch" ' + attrs + (on ? ' checked' : '') + ' aria-label="' + esc(label || '开关') + '"><span class="tr"></span></label>'; }
function txType(t) { return esc(TYPE[t] || t); }
function txStatus(s) { var m = STATUS[s] || [s, 'off']; return badge(m[0], m[1]); }
function txAmt(e) { var a = e.amount; return '<b class="num ' + cls(a) + '">' + sgn(a) + '</b>'; }

// ---------- 登录 ----------
function showLogin(msg) {
  document.title = '登录｜8K 后台管理';
  $('#app').innerHTML = '<div class="login-wrap"><main class="login-card" id="main"><div class="brand-l"><img src="/assets/logo-mark.svg" alt="" width="44" height="44"><h1>8K 后台管理<small>ADMIN CONSOLE</small></h1></div><span class="demo-chip">演示环境 · 演示币</span>' +
    '<form id="lf" novalidate><div><label class="lbl" for="lu">管理员账号</label><input class="fld" id="lu" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>' +
    '<div><label class="lbl" for="lp">密码</label><input class="fld" id="lp" name="password" type="password" autocomplete="current-password" required></div>' +
    '<p class="err" id="le" role="alert">' + esc(msg || '') + '</p><button class="ab pri block" id="lb" type="submit">登录</button></form>' +
    '<p class="hint tip">后台与玩家账号相互独立。登录失败过多会被限流/临时锁定。演示账号见 README（仅限演示环境）。</p></main></div>';
  $('#lu').focus();
  $('#lf').addEventListener('submit', function (e) {
    e.preventDefault(); var b = $('#lb'); b.disabled = true; $('#le').textContent = '';
    call('POST', '/api/admin/login', { username: $('#lu').value.trim(), password: $('#lp').value }).then(function (r) { csrf = r.csrf; adminName = r.admin.username; start(); })
      .catch(function (er) { $('#le').textContent = er.message; b.disabled = false; $('#lp').value = ''; $('#lp').focus(); });
  });
}

// ---------- 外壳与路由 ----------
function shell() {
  $('#app').innerHTML = '<div class="shell"><div class="scrim-a" id="scrim"></div>' +
    '<aside class="side" id="side" aria-label="后台导航"><div class="brand-s"><img src="/assets/logo-mark.svg" alt="" width="38" height="38"><div><b>8K</b><small>后台管理 · 演示</small></div></div><nav id="nav">' +
    NAV.map(function (n) { return '<a href="#/' + n[0] + '" data-r="' + n[0] + '">' + ico(n[0]) + n[1] + '</a>'; }).join('') + '</nav>' +
    '<div class="foot"><div>当前账号：<b>' + esc(adminName) + '</b></div><div>演示币 · 非真实资金</div><a class="ab block" href="/" target="_blank" rel="noopener" style="margin-top:10px">打开前台 ↗</a><button class="ab block" id="lo" type="button">退出登录</button></div></aside>' +
    '<header class="topbar"><div class="in"><button class="menu" id="mb" type="button" aria-label="打开菜单" aria-controls="side" aria-expanded="false">' + ico('menu') + '</button><div class="ttl" id="ttl">后台</div><span class="who">' + esc(adminName) + '</span></div></header>' +
    '<main class="main" id="main" tabindex="-1"></main></div>';
  function side(on) { $('#side').classList.toggle('open', on); $('#scrim').classList.toggle('on', on); $('#mb').setAttribute('aria-expanded', on ? 'true' : 'false'); }
  $('#mb').addEventListener('click', function () { side(!$('#side').classList.contains('open')); });
  $('#scrim').addEventListener('click', function () { side(false); });
  $('#nav').addEventListener('click', function (e) { if (e.target.closest('a')) side(false); });
  $('#lo').addEventListener('click', function () { call('POST', '/api/admin/logout', {}).catch(function () {}).then(function () { csrf = ''; showLogin('已退出登录'); }); });
}
var PAGES = { dashboard: pDashboard, players: pPlayers, games: pGames, providers: pProviders, transactions: pTransactions, settings: pSettings };
var TITLES = { dashboard: '仪表盘', players: '玩家管理', games: '游戏管理', providers: '供应商状态', transactions: '交易查询', settings: '系统设置' };
function route() {
  if (!csrf || !$('#main') || !$('#nav')) return;
  var h = location.hash.replace(/^#\/?/, '').split('/'), name = PAGES[h[0]] ? h[0] : 'dashboard', arg = h[1] || '';
  $$('#nav a').forEach(function (a) { if (a.getAttribute('data-r') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  var t = name === 'players' && arg ? '玩家详情' : TITLES[name]; $('#ttl').textContent = t; document.title = t + '｜8K 后台管理';
  seq++; var my = seq, root = $('#main'); root.innerHTML = '<div class="empty-s">加载中…</div>';
  Promise.resolve().then(function () { return PAGES[name](root, arg, function () { return my === seq; }); }).catch(function (e) { if (my === seq && e.code !== 'ADMIN_UNAUTHORIZED') root.innerHTML = '<div class="card"><p class="err">' + esc(e.message) + '</p><button class="ab pri" id="rt">重试</button></div>', $('#rt').addEventListener('click', route); });
}
function start() {
  shell();
  call('GET', '/api/admin/games?limit=1').then(function (r) { r.categories.forEach(function (c) { CAT[c.id] = c.label; }); }).catch(function () {}).then(route);
}

// ---------- 仪表盘 ----------
function pDashboard(root, _a, live) {
  return call('GET', '/api/admin/dashboard').then(function (d) {
    if (!live()) return;
    var cn = d.currencyLabel || '演示币', mx = Math.max.apply(null, d.series.map(function (s) { return Math.max(s.bets, s.wins); }).concat([1]));
    root.innerHTML = '<h2 class="pg">仪表盘 <small>' + esc(cn) + ' · 数据更新于 ' + fdt(d.serverTime) + '</small></h2>' +
      (d.maintenance.enabled ? '<div class="banner-m">⚠ 站点横幅已开启：' + esc(d.maintenance.text) + (d.maintenance.blockPlay ? '（维护模式：已禁止启动游戏）' : '') + '</div>' : '') +
      (d.persistence ? '' : '<div class="banner-m">当前未启用磁盘持久化（DATA_DIR=off），重启后数据会丢失。</div>') +
      '<div class="stats">' +
      '<div class="stat hero"><small>累计 GGR（投注 − 派彩）</small><b class="' + cls(d.totals.ggr) + '">' + sgn(d.totals.ggr) + '</b><em>RTP ' + (d.totals.rtp == null ? '—' : d.totals.rtp + '%') + ' · 共 ' + d.totals.rounds + ' 局 · 今日 GGR ' + sgn(d.today.ggr) + '</em></div>' +
      '<div class="stat"><small>玩家总数</small><b>' + d.players.total + '</b><em>今日新增 ' + d.players.newToday + ' · 24h 活跃 ' + d.players.active24h + (d.players.frozen ? ' · 冻结 ' + d.players.frozen : '') + '</em></div>' +
      '<div class="stat"><small>钱包总余额</small><b>' + fmt(d.wallet.total) + '</b><em>人均 ' + fmt(d.wallet.average) + ' · 最高 ' + fmt(d.wallet.max) + '</em></div>' +
      '<div class="stat"><small>累计投注</small><b>' + fmt(d.totals.bets) + '</b><em>今日 ' + fmt(d.today.bets) + '</em></div>' +
      '<div class="stat"><small>累计派彩</small><b>' + fmt(d.totals.wins) + '</b><em>今日 ' + fmt(d.today.wins) + '</em></div>' +
      '<div class="stat"><small>累计充值（演示）</small><b>' + fmt(d.totals.deposits) + '</b><em>运营调整净额 ' + sgn(d.totals.adjustments) + '</em></div>' +
      '<div class="stat"><small>游戏上架</small><b>' + d.games.enabled + ' / ' + d.games.total + '</b><em><a class="lnk" href="#/games">管理游戏 →</a></em></div></div>' +
      '<div class="grid g2"><section class="card"><h3 class="sec">近 7 日投注 / 派彩</h3><div class="chart" role="img" aria-label="近7日投注与派彩柱状图">' +
      d.series.map(function (s) { return '<div class="col"><span class="v ' + cls(s.ggr) + '">' + (s.ggr > 0 ? '+' : '') + Math.round(s.ggr) + '</span><div class="bars"><i class="bar b" style="height:' + Math.max(1, s.bets / mx * 100) + '%" title="投注 ' + fmt(s.bets) + '"></i><i class="bar w" style="height:' + Math.max(1, s.wins / mx * 100) + '%" title="派彩 ' + fmt(s.wins) + '"></i></div><span class="d">' + s.date.slice(5) + '</span></div>'; }).join('') +
      '</div><div class="legend"><span><i style="background:var(--violet)"></i>投注</span><span><i style="background:var(--rg2)"></i>派彩</span><span>柱顶数字 = 当日 GGR</span></div></section>' +
      '<section class="card"><h3 class="sec">热门游戏 TOP 6（按投注额）</h3>' + table([
        { h: '游戏', cls: 'nl', f: function (g) { return esc(g.name) + '<div class="mono">' + esc(g.gameId) + '</div>'; } }, { h: '投注', r: 1, f: function (g) { return fmt(g.bets); } }, { h: '局数', r: 1, f: function (g) { return g.rounds; } }, { h: 'GGR', r: 1, f: function (g) { return '<b class="' + cls(g.ggr) + '">' + sgn(g.ggr) + '</b>'; } }], d.topGames, '暂无游戏数据，去前台玩几局吧') + '</section></div>' +
      '<section class="card" style="margin-top:12px"><h3 class="sec">最近交易 <a class="lnk" href="#/transactions" style="font-size:14px;margin-left:4px">查看全部 →</a></h3>' + txTable(d.recent) + '</section>';
  });
}
function txTable(rows) {
  return table([
    { h: '时间', f: function (e) { return '<span class="num">' + fdt(e.createdAt) + '</span>'; } },
    { h: '玩家', f: function (e) { return e.username ? '<a class="lnk" href="#/players/' + esc(e.userId) + '">' + esc(e.username) + '</a>' : '—'; } },
    { h: '类型', f: function (e) { return txType(e.type); } },
    { h: '游戏 / 来源', f: function (e) { return e.gameName ? esc(e.gameName) : esc(e.providerLabel || e.provider); } },
    { h: '金额', r: 1, f: function (e) { return e.type === 'settle' ? '<span class="num">投 ' + fmt(e.bet) + ' / 赢 ' + fmt(e.win) + '</span><br>' + txAmt(e) : txAmt(e); } },
    { h: '余额', r: 1, f: function (e) { return '<span class="num">' + fmt(e.balanceAfter) + '</span>'; } },
    { h: '状态', f: function (e) { return txStatus(e.status); } },
    { h: '单号', f: function (e) { return '<span class="mono">' + esc(e.txId) + '</span>' + (e.reason ? '<br><span class="hint">原因：' + esc(e.reason) + '</span>' : ''); } }
  ], rows, '暂无交易记录');
}

// ---------- 玩家 ----------
var PS = { q: '', status: '', sort: 'created', page: 1 };
function pPlayers(root, id, live) {
  if (id) return pPlayerDetail(root, id, live);
  function load() {
    return call('GET', '/api/admin/players?' + qs({ q: PS.q, status: PS.status, sort: PS.sort, page: PS.page, limit: 20 })).then(function (r) {
      if (!live()) return;
      $('#plist').innerHTML = table([
        { h: '玩家', cls: 'nl', f: function (p) { return '<a class="lnk" href="#/players/' + esc(p.id) + '">' + esc(p.username) + '</a>'; } },
        { h: '余额', r: 1, f: function (p) { return '<b class="num">' + fmt(p.balance) + '</b>'; } },
        { h: '状态', f: function (p) { return p.frozen ? badge('已冻结', 'bad') : badge('正常', 'ok'); } },
        { h: '累计投注', r: 1, f: function (p) { return '<span class="num">' + fmt(p.totalBet) + '</span>'; } },
        { h: '累计派彩', r: 1, f: function (p) { return '<span class="num">' + fmt(p.totalWin) + '</span>'; } },
        { h: 'GGR', r: 1, f: function (p) { return '<b class="num ' + cls(p.ggr) + '">' + sgn(p.ggr) + '</b>'; } },
        { h: '注册时间', f: function (p) { return '<span class="num">' + fdt(p.createdAt) + '</span>'; } },
        { h: '最后登录', f: function (p) { return '<span class="num">' + fdt(p.lastLoginAt) + '</span>'; } },
        { h: '操作', f: function (p) { return '<a class="ab ghost sm" href="#/players/' + esc(p.id) + '">管理</a>'; } }
      ], r.players, '没有符合条件的玩家') + pager(r.total, r.page, r.limit);
    }).catch(fail);
  }
  root.innerHTML = '<h2 class="pg">玩家管理</h2><section class="card"><form class="tools" id="pf" role="search"><div class="wide"><label class="lbl" for="pq">搜索用户名 / ID</label><input class="fld" id="pq" type="search" value="' + esc(PS.q) + '" placeholder="输入用户名关键字" autocomplete="off"></div>' +
    '<div><label class="lbl" for="ps">状态</label><select class="fld" id="ps"><option value="">全部</option><option value="active"' + (PS.status === 'active' ? ' selected' : '') + '>正常</option><option value="frozen"' + (PS.status === 'frozen' ? ' selected' : '') + '>已冻结</option></select></div>' +
    '<div><label class="lbl" for="po">排序</label><select class="fld" id="po">' + [['created', '注册时间'], ['balance', '余额'], ['bet', '累计投注'], ['login', '最后登录']].map(function (o) { return '<option value="' + o[0] + '"' + (PS.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></form><div id="plist"></div></section>';
  var t; $('#pq').addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { PS.q = $('#pq').value.trim(); PS.page = 1; load(); }, 300); });
  $('#pf').addEventListener('submit', function (e) { e.preventDefault(); });
  $('#ps').addEventListener('change', function () { PS.status = this.value; PS.page = 1; load(); });
  $('#po').addEventListener('change', function () { PS.sort = this.value; PS.page = 1; load(); });
  onPager($('#plist'), function (p) { PS.page = p; load(); });
  return load();
}
function pPlayerDetail(root, id, live) {
  var page = 1;
  function load() {
    return call('GET', '/api/admin/players/' + encodeURIComponent(id) + '?' + qs({ page: page, limit: 15 })).then(function (r) {
      if (!live()) return; var p = r.player;
      root.innerHTML = '<h2 class="pg"><a class="ab ghost sm" href="#/players" aria-label="返回玩家列表">← 返回</a> ' + esc(p.username) + ' ' + (p.frozen ? badge('已冻结', 'bad') : badge('正常', 'ok')) + '</h2>' +
        '<div class="stats"><div class="stat hero"><small>钱包余额（' + esc(r.currency) + '）</small><b>' + fmt(p.balance) + '</b><em>累计投注 ' + fmt(p.totalBet) + ' · 派彩 ' + fmt(p.totalWin) + ' · GGR <span class="' + cls(p.ggr) + '">' + sgn(p.ggr) + '</span></em></div>' +
        '<div class="stat"><small>局数</small><b>' + p.rounds + '</b></div><div class="stat"><small>累计充值</small><b>' + fmt(p.deposits) + '</b></div></div>' +
        '<div class="grid g2"><section class="card"><h3 class="sec">账户信息</h3><dl class="kv"><dt>玩家 ID</dt><dd class="mono">' + esc(p.id) + '</dd><dt>地区</dt><dd>' + esc(p.region) + '</dd><dt>注册时间</dt><dd>' + fdt(p.createdAt) + '</dd><dt>最后登录</dt><dd>' + fdt(p.lastLoginAt) + '</dd><dt>最后活动</dt><dd>' + fdt(p.lastActivityAt) + '</dd><dt>已设密码</dt><dd>' + (p.hasPassword ? '是' : '否') + '</dd>' + (p.frozen ? '<dt>冻结原因</dt><dd>' + esc(p.frozenReason || '—') + '</dd>' : '') + '</dl></section>' +
        '<section class="card"><h3 class="sec">账户操作</h3><div class="chips"><button class="ab pri" id="adj" type="button">调整演示余额</button>' + (p.frozen ? '<button class="ab dark" id="frz" type="button">解冻账户</button>' : '<button class="ab danger" id="frz" type="button">冻结账户</button>') + '<button class="ab ghost" id="rpw" type="button">重置密码</button></div><p class="hint" style="margin-top:10px">余额调整仅影响演示币，写入账本并记录审计日志；冻结会立即踢下线并禁止登录/充值/投注。</p></section></div>' +
        '<section class="card" style="margin-top:12px"><h3 class="sec">钱包账本</h3>' + txTable(r.ledger.rows) + pager(r.ledger.total, r.ledger.page, r.ledger.limit) + '</section>';
      onPager(root, function (pg) { page = pg; load(); });
      $('#adj').addEventListener('click', function () {
        dialog('调整演示余额', '当前余额 <b>' + fmt(p.balance) + '</b>。正数加款，负数扣款（余额不能为负）。', [{ name: 'amount', label: '金额（可为负数）', placeholder: '例如 500 或 -100', inputmode: 'decimal', required: 1 }, { name: 'reason', label: '调整原因（必填，会写入账本）', placeholder: '如：活动补偿 / 测试', required: 1 }], '确认调整').then(function (v) {
          if (!v) return; var n = Number(v.amount); if (!isFinite(n) || n === 0) return toast('请输入有效的非零金额', true);
          call('POST', '/api/admin/players/' + encodeURIComponent(id) + '/adjust', { amount: n, reason: v.reason }).then(function (r2) { toast('已调整，新余额 ' + fmt(r2.balance)); load(); }).catch(fail);
        });
      });
      $('#frz').addEventListener('click', function () {
        if (p.frozen) { call('POST', '/api/admin/players/' + encodeURIComponent(id) + '/freeze', { frozen: false }).then(function () { toast('已解冻'); load(); }).catch(fail); return; }
        dialog('冻结账户', '冻结后玩家会立即下线，且无法登录、充值或投注。', [{ name: 'reason', label: '冻结原因（必填）', placeholder: '如：涉嫌刷量', required: 1 }], '确认冻结', true).then(function (v) {
          if (v) call('POST', '/api/admin/players/' + encodeURIComponent(id) + '/freeze', { frozen: true, reason: v.reason }).then(function () { toast('已冻结'); load(); }).catch(fail);
        });
      });
      $('#rpw').addEventListener('click', function () {
        dialog('重置玩家密码', '新密码 8-64 位，需同时含字母和数字。玩家的现有会话会被下线。', [{ name: 'password', label: '新密码', type: 'password', required: 1 }], '确认重置', true).then(function (v) {
          if (v) call('POST', '/api/admin/players/' + encodeURIComponent(id) + '/password', { password: v.password }).then(function () { toast('密码已重置'); }).catch(fail);
        });
      });
    });
  }
  return load();
}

// ---------- 游戏 ----------
var GS = { q: '', category: '', provider: '', enabled: '', flag: '', page: 1 }, SEL = {};
function pGames(root, _a, live) {
  var meta = null;
  function opts(list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (o) { return '<option value="' + esc(o.id) + '"' + (cur === o.id ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join(''); }
  function load() {
    return call('GET', '/api/admin/games?' + qs({ q: GS.q, category: GS.category, provider: GS.provider, enabled: GS.enabled, flag: GS.flag, page: GS.page, limit: 30 })).then(function (r) {
      if (!live()) return;
      if (!meta) { meta = r; $('#gcat').innerHTML = opts(r.categories, GS.category, '全部分类'); $('#gprov').innerHTML = opts(r.providers, GS.provider, '全部供应商'); }
      var s = r.summary;
      $('#gsum').textContent = '共 ' + s.total + ' 款 · 上架 ' + s.enabled + ' · 热门 ' + s.hot + ' · 新游 ' + s.isNew + ' ｜ 当前筛选 ' + r.total + ' 款';
      $('#glist').innerHTML = table([
        { h: '选择', cls: 'nl', f: function (g) { return '<label class="chk"><input type="checkbox" data-sel="' + esc(g.id) + '"' + (SEL[g.id] ? ' checked' : '') + ' aria-label="选择 ' + esc(g.name) + '"></label>'; } },
        { h: '游戏', cls: 'nl', f: function (g) { return '<b>' + esc(g.name) + '</b>' + (g.customized ? ' ' + badge('已自定义', 'vio') : '') + '<div class="mono">' + esc(g.id) + ' · ' + esc(g.vendor) + '</div>'; } },
        { h: '分类', f: function (g) { return '<select class="fld sm" data-f="category" data-id="' + esc(g.id) + '" aria-label="分类：' + esc(g.name) + '">' + r.categories.map(function (c) { return '<option value="' + esc(c.id) + '"' + (g.category === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>'; } },
        { h: '上架', f: function (g) { return sw('data-f="enabled" data-id="' + esc(g.id) + '"', g.enabled, '上架：' + g.name); } },
        { h: '热门', f: function (g) { return sw('data-f="hot" data-id="' + esc(g.id) + '"', g.hot, '热门：' + g.name); } },
        { h: '新游', f: function (g) { return sw('data-f="isNew" data-id="' + esc(g.id) + '"', g.isNew, '新游：' + g.name); } },
        { h: '排序', f: function (g) { return '<input class="fld sm sorti" type="number" inputmode="numeric" step="1" data-f="sort" data-id="' + esc(g.id) + '" value="' + g.sort + '" aria-label="排序：' + esc(g.name) + '（越小越靠前）">'; } }
      ], r.games, '没有符合条件的游戏') + pager(r.total, r.page, r.limit);
      bulkBar();
    }).catch(fail);
  }
  function bulkBar() { var n = Object.keys(SEL).length; var b = $('#bulk'); b.hidden = !n; $('#bn').textContent = '已选 ' + n + ' 款'; }
  root.innerHTML = '<h2 class="pg">游戏管理 <small id="gsum"></small></h2><section class="card"><form class="tools" id="gf" role="search"><div class="wide"><label class="lbl" for="gq">搜索名称 / ID / 厂商</label><input class="fld" id="gq" type="search" value="' + esc(GS.q) + '" autocomplete="off"></div>' +
    '<div><label class="lbl" for="gcat">分类</label><select class="fld" id="gcat"></select></div><div><label class="lbl" for="gprov">供应商</label><select class="fld" id="gprov"></select></div>' +
    '<div><label class="lbl" for="gen">状态</label><select class="fld" id="gen"><option value="">全部</option><option value="1"' + (GS.enabled === '1' ? ' selected' : '') + '>已上架</option><option value="0"' + (GS.enabled === '0' ? ' selected' : '') + '>已下架</option></select></div>' +
    '<div><label class="lbl" for="gfl">标记</label><select class="fld" id="gfl"><option value="">全部</option><option value="hot"' + (GS.flag === 'hot' ? ' selected' : '') + '>热门</option><option value="new"' + (GS.flag === 'new' ? ' selected' : '') + '>新游</option></select></div></form>' +
    '<p class="hint" style="margin-bottom:8px">“排序”数字越小越靠前（默认 = 目录顺序）；下架后前台目录与启动接口均不可见。修改立即生效并持久化。</p><div id="glist"></div>' +
    '<div class="bulk" id="bulk" hidden><b id="bn" style="margin-right:auto"></b><button class="ab pri sm" data-b="on">批量上架</button><button class="ab ghost sm" data-b="off">批量下架</button><button class="ab ghost sm" data-b="hot">设为热门</button><button class="ab ghost sm" data-b="unhot">取消热门</button><button class="ab ghost sm" data-b="reset">恢复默认</button><button class="ab ghost sm" data-b="clear">清除选择</button></div></section>';
  var t; $('#gq').addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { GS.q = $('#gq').value.trim(); GS.page = 1; load(); }, 300); });
  $('#gf').addEventListener('submit', function (e) { e.preventDefault(); });
  [['gcat', 'category'], ['gprov', 'provider'], ['gen', 'enabled'], ['gfl', 'flag']].forEach(function (x) { $('#' + x[0]).addEventListener('change', function () { GS[x[1]] = this.value; GS.page = 1; load(); }); });
  onPager($('#glist'), function (p) { GS.page = p; load(); });
  $('#glist').addEventListener('change', function (e) {
    var el = e.target, sel = el.getAttribute('data-sel');
    if (sel) { if (el.checked) SEL[sel] = 1; else delete SEL[sel]; return bulkBar(); }
    var f = el.getAttribute('data-f'); if (!f) return; var id = el.getAttribute('data-id'), body = {};
    if (f === 'category') body.category = el.value; else if (f === 'sort') { if (el.value === '' || !isFinite(+el.value)) { toast('排序需为数字', true); return load(); } body.sort = +el.value; } else body[f] = el.checked;
    call('POST', '/api/admin/games/' + encodeURIComponent(id), body).then(function () { toast('已保存'); if (f === 'sort' || f === 'category') load(); }).catch(function (er) { fail(er); load(); });
  });
  $('#bulk').addEventListener('click', function (e) {
    var b = e.target.closest('[data-b]'); if (!b) return; var k = b.getAttribute('data-b'), ids = Object.keys(SEL);
    if (k === 'clear') { SEL = {}; return load(); }
    var body = { ids: ids }; if (k === 'on') body.enabled = true; else if (k === 'off') body.enabled = false; else if (k === 'hot') body.hot = true; else if (k === 'unhot') body.hot = false; else if (k === 'reset') body.reset = true;
    call('POST', '/api/admin/games/bulk', body).then(function (r) { toast('已更新 ' + r.updated + ' 款'); SEL = {}; load(); }).catch(fail);
  });
  return load();
}

// ---------- 供应商 ----------
function pProviders(root, _a, live) {
  return call('GET', '/api/admin/providers').then(function (r) {
    if (!live()) return;
    var vis = r.providers.filter(function (p) { return !p.hidden || p.enabled || p.activity.tx; });
    root.innerHTML = '<h2 class="pg">供应商状态 <small>不显示任何密钥 · 签名校验模式：' + esc(r.signatureMode) + '</small></h2><div class="grid g3">' + vis.map(function (p) {
      var m = MODE[p.mode] || [p.mode, 'off'], cr = p.credentials;
      return '<section class="card"><h3 class="sec" style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><span style="min-width:0;overflow-wrap:anywhere">' + esc(p.label) + '</span>' + badge(m[0], m[1]) + '</h3><div class="mono" style="margin-bottom:10px">' + esc(p.id) + ' · 适配器 ' + esc(p.adapter) + '</div>' +
        '<dl class="kv"><dt>状态</dt><dd>' + (p.enabled ? badge('已启用', 'ok') : badge('未启用', 'off')) + '</dd><dt>钱包模式</dt><dd>' + (p.walletMode === 'transfer' ? '转账钱包' : '共享钱包') + '</dd><dt>币种</dt><dd>' + esc(p.currency || '—') + '</dd>' +
        '<dt>凭据</dt><dd>' + [['baseUrl', '地址'], ['apiKey', 'Key'], ['secret', '密钥']].map(function (c) { return badge(c[1] + (cr[c[0]] ? ' ✓' : ' ✗'), cr[c[0]] ? 'ok' : 'off'); }).join(' ') + '</dd>' +
        '<dt>上游主机</dt><dd>' + esc(p.baseHost || '—') + '</dd><dt>IP 白名单</dt><dd>' + (p.ipAllowlist ? p.ipAllowlist + ' 条' : '未设置') + '</dd><dt>游戏</dt><dd>' + p.games.enabled + ' / ' + p.games.total + ' 上架</dd>' +
        '<dt>24h 交易</dt><dd>' + p.activity.tx24h + ' 笔</dd><dt>累计 GGR</dt><dd class="' + cls(p.activity.ggr) + '"><b>' + sgn(p.activity.ggr) + '</b></dd><dt>最近活动</dt><dd>' + fdt(p.activity.lastAt) + '</dd></dl></section>';
    }).join('') + '</div><p class="hint" style="margin-top:12px">' + esc(r.note) + ' HUIDU 在未配置真实凭据时自动使用内置模拟器（演示）。</p>';
  });
}

// ---------- 交易 ----------
var TS = { type: '', player: '', game: '', provider: '', status: '', from: '', to: '', min: '', max: '', q: '', page: 1 };
function pTransactions(root, _a, live) {
  var meta = false;
  function load() {
    return call('GET', '/api/admin/transactions?' + qs(Object.assign({}, TS, { limit: 25 }))).then(function (r) {
      if (!live()) return;
      if (!meta) { meta = true; $('#tt').innerHTML = '<option value="">全部类型</option>' + r.types.map(function (t) { return '<option value="' + esc(t) + '"' + (TS.type === t ? ' selected' : '') + '>' + esc(TYPE[t] || t) + '</option>'; }).join(''); $('#tp').innerHTML = '<option value="">全部来源</option>' + r.providers.map(function (p) { return '<option value="' + esc(p.id) + '"' + (TS.provider === p.id ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join(''); }
      $('#tsum').innerHTML = '<div class="stat"><small>筛选结果</small><b>' + r.total + '</b></div><div class="stat"><small>投注合计</small><b>' + fmt(r.summary.bets) + '</b></div><div class="stat"><small>派彩合计</small><b>' + fmt(r.summary.wins) + '</b></div><div class="stat"><small>GGR</small><b class="' + cls(r.summary.ggr) + '">' + sgn(r.summary.ggr) + '</b></div>';
      $('#tlist').innerHTML = txTable(r.transactions) + pager(r.total, r.page, r.limit);
    }).catch(fail);
  }
  function F(id, label, type, extra) { return '<div><label class="lbl" for="' + id + '">' + label + '</label><input class="fld" id="' + id + '" type="' + (type || 'text') + '" ' + (extra || '') + '></div>'; }
  root.innerHTML = '<h2 class="pg">交易查询 <small>支持多条件组合 · 金额单位：演示币</small></h2><section class="card"><form class="tools" id="tf">' +
    '<div><label class="lbl" for="tt">类型</label><select class="fld" id="tt"><option value="">全部类型</option></select></div>' +
    '<div><label class="lbl" for="tp">来源</label><select class="fld" id="tp"><option value="">全部来源</option></select></div>' +
    '<div><label class="lbl" for="tst">状态</label><select class="fld" id="tst"><option value="">全部状态</option><option value="ok">成功</option><option value="rolled_back">已冲正</option></select></div>' +
    F('tpl', '玩家（用户名）', 'search', 'autocomplete="off"') + F('tg', '游戏（名称 / ID）', 'search', 'autocomplete="off"') + F('tq', '单号 / 轮次号', 'search', 'autocomplete="off"') +
    F('tfr', '开始日期', 'date') + F('tto', '结束日期', 'date') + F('tmin', '最小金额', 'number', 'inputmode="decimal" min="0" step="any"') + F('tmax', '最大金额', 'number', 'inputmode="decimal" min="0" step="any"') +
    '<div class="wide" style="display:flex;gap:10px;align-items:flex-end"><button class="ab pri" type="submit" style="flex:1">查询</button><button class="ab ghost" type="button" id="trs" style="flex:1">重置</button></div></form>' +
    '<div class="stats" id="tsum" style="margin:12px 0 4px"></div><div id="tlist"></div></section>';
  var map = { tpl: 'player', tg: 'game', tq: 'q', tfr: 'from', tto: 'to', tmin: 'min', tmax: 'max', tst: 'status' };
  Object.keys(map).forEach(function (id) { $('#' + id).value = TS[map[id]]; });
  $('#tf').addEventListener('submit', function (e) {
    e.preventDefault(); Object.keys(map).forEach(function (id) { TS[map[id]] = $('#' + id).value.trim(); }); TS.type = $('#tt').value; TS.provider = $('#tp').value; TS.page = 1; load();
  });
  $('#trs').addEventListener('click', function () { TS = { type: '', player: '', game: '', provider: '', status: '', from: '', to: '', min: '', max: '', q: '', page: 1 }; $('#tf').reset(); load(); });
  onPager($('#tlist'), function (p) { TS.page = p; load(); });
  return load();
}

// ---------- 设置 ----------
function pSettings(root, _a, live) {
  return Promise.all([call('GET', '/api/admin/settings'), call('GET', '/api/admin/audit?limit=30')]).then(function (rs) {
    if (!live()) return; var s = rs[0].settings, sys = rs[0].system;
    root.innerHTML = '<h2 class="pg">系统设置</h2><div class="grid g2"><section class="card"><h3 class="sec">站点维护横幅</h3><form id="sf" class="grid" novalidate>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span class="lbl" style="margin:0">显示横幅</span>' + sw('id="sm-en" name="en"', s.maintenance.enabled, '显示横幅') + '</div>' +
      '<div><label class="lbl" for="sm-tx">公告内容（最多 200 字）</label><textarea class="fld" id="sm-tx" maxlength="200" placeholder="例如：今晚 02:00-03:00 例行维护，期间可能无法开始游戏。">' + esc(s.maintenance.text) + '</textarea></div>' +
      '<div><label class="lbl" for="sm-lv">样式</label><select class="fld" id="sm-lv"><option value="info"' + (s.maintenance.level === 'info' ? ' selected' : '') + '>提示（紫色）</option><option value="warn"' + (s.maintenance.level === 'warn' ? ' selected' : '') + '>警告（暖色）</option></select></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span><span class="lbl" style="margin:0">维护模式：禁止启动游戏</span><span class="hint">仅在横幅开启时生效，已在玩的回合不受影响。</span></span>' + sw('id="sm-bp"', s.blockPlay, '维护模式') + '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span class="lbl" style="margin:0">开放玩家注册</span>' + sw('id="sm-rg"', s.registrationOpen, '开放注册') + '</div>' +
      '<button class="ab pri block" type="submit">保存设置</button></form></section>' +
      '<section class="card"><h3 class="sec">修改管理员密码</h3><form id="pf2" class="grid" novalidate><div><label class="lbl" for="po1">当前密码</label><input class="fld" id="po1" type="password" autocomplete="current-password"></div><div><label class="lbl" for="pn1">新密码（8-64 位，含字母和数字）</label><input class="fld" id="pn1" type="password" autocomplete="new-password"></div><button class="ab dark block" type="submit">修改密码</button></form>' +
      '<h3 class="sec" style="margin-top:20px">系统信息</h3><dl class="kv"><dt>磁盘持久化</dt><dd>' + (sys.persistence ? badge('已启用', 'ok') : badge('未启用', 'warn')) + '</dd><dt>DATA_DIR</dt><dd class="mono">' + esc(sys.dataDir || '—') + '</dd><dt>Node</dt><dd>' + esc(sys.node) + '</dd><dt>运行时长</dt><dd>' + Math.floor(sys.uptimeSec / 60) + ' 分钟</dd><dt>玩家 / 账本</dt><dd>' + sys.players + ' / ' + sys.ledgerEntries + '</dd><dt>回调签名</dt><dd>' + esc(sys.signatureMode) + '</dd></dl>' +
      (sys.persistence ? '<p class="hint" style="margin-top:8px">免费托管的磁盘通常是临时的：服务重启/重新部署后数据会重置（见 DEPLOY.md）。</p>' : '') + '</section></div>' +
      '<section class="card" style="margin-top:12px"><h3 class="sec">操作审计日志（最近 30 条）</h3>' + table([
        { h: '时间', f: function (a) { return '<span class="num">' + fdt(a.t) + '</span>'; } }, { h: '管理员', f: function (a) { return esc(a.admin); } }, { h: '操作', f: function (a) { return esc(ACTION[a.action] || a.action); } }, { h: '对象', f: function (a) { return esc(a.target || '—'); } },
        { h: '详情', f: function (a) { return '<span class="mono">' + esc(a.detail ? JSON.stringify(a.detail) : '') + '</span>'; } }], rs[1].entries, '暂无记录') + '</section>';
    $('#sf').addEventListener('submit', function (e) {
      e.preventDefault();
      call('POST', '/api/admin/settings', { maintenance: { enabled: $('#sm-en').checked, text: $('#sm-tx').value.trim(), level: $('#sm-lv').value }, blockPlay: $('#sm-bp').checked, registrationOpen: $('#sm-rg').checked }).then(function () { toast('设置已保存'); route(); }).catch(fail);
    });
    $('#pf2').addEventListener('submit', function (e) {
      e.preventDefault();
      call('POST', '/api/admin/password', { oldPassword: $('#po1').value, newPassword: $('#pn1').value }).then(function () { toast('密码已修改'); $('#po1').value = ''; $('#pn1').value = ''; }).catch(fail);
    });
  });
}

// ---------- 启动 ----------
window.addEventListener('hashchange', route);
call('GET', '/api/admin/session').then(function (r) { if (r.authenticated) { csrf = r.csrf; adminName = r.admin.username; start(); } else showLogin(''); }).catch(function (e) { showLogin('无法连接服务器：' + e.message); });
