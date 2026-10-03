/* 共享 UI：图标、页眉/底部导航、Toast、Sheet(充值/记录/账户)。ES2017 语法。 */
import { api, state, onWallet, fmt, errText, store } from './api.js';

var ICONS = {
  logo: ['0 0 380 210', '<g fill="none" stroke="currentColor" stroke-width="26" stroke-linejoin="round" stroke-linecap="round"><circle cx="100" cy="62" r="36"/><circle cx="100" cy="142" r="46"/><path d="M232 24V186M338 26L236 108M266 92L342 184"/></g>'],
  live: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c.6-3.6 3.6-5.6 7-5.6s6.4 2 7 5.6"/><path d="M3 4.5C1.8 6 1.8 9 3 10.5M21 4.5c1.2 1.5 1.2 4.5 0 6"/></g>'],
  slots: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M9 5v14M15 5v14"/><path d="M5.8 12h.01M12 12h.01M18.2 12h.01"/></g>'],
  table: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="10" height="14" rx="2" transform="rotate(-10 9 11)"/><rect x="10" y="6" width="10" height="14" rx="2" transform="rotate(8 15 13)"/></g>'],
  crash: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 10 14M13 5c4-1.5 7-1 7-1s.5 3-1 7l-5 5-4-4z"/><circle cx="15.5" cy="8.5" r="1.4"/><path d="M8 11 5 12l-1 4M13 16l-1 3 4-1 1-3"/></g>'],
  sports: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8l3.4 2.5-1.3 4h-4.2l-1.3-4zM12 8V3M15.4 10.5l4.5-1.5M14.1 14.5l2.6 3.7M9.9 14.5l-2.6 3.7M8.6 10.5 4.1 9"/></g>'],
  fish: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c3-5 8-6 12-3l4.500-3.200v12.400L15 15c-4 3-9 2-12-3z"/><path d="M8 11.200h.01"/></g>'],
  all: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></g>'],
  search: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></g>'],
  back: ['0 0 24 24', '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'],
  close: ['0 0 24 24', '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'],
  plus: ['0 0 24 24', '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'],
  snd: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></g>'],
  mute: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></g>'],
  fs: ['0 0 24 24', '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
  fsx: ['0 0 24 24', '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
  home: ['0 0 24 24', '<path d="M4 11 12 4l8 7v9H14v-6h-4v6H4z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'],
  list: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></g>'],
  user: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-4 4-6 7.5-6s6.700 2 7.500 6"/></g>'],
  refresh: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.500-5.800M20 4v4.500h-4.500"/></g>'],
  rotate: ['0 0 48 48', '<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="5" width="20" height="38" rx="4"/><path d="M22 38h4"/></g>'],
  bolt: ['0 0 24 24', '<path d="M13 3 5 13.500h6L10 21l8-10.500h-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'],
  bomb: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="14" r="6"/><path d="M15 9.500 18 6.500M17 4l3 3"/></g>'],
  gem: ['0 0 24 24', '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 4h12l3.500 5L12 21 2.500 9z"/><path d="M2.500 9h19M9 4l-2 5 5 12 5-12-2-5"/></g>']
};
export function icon(n, cls) {
  var i = ICONS[n]; if (!i) return '';
  return '<svg viewBox="' + i[0] + '" aria-hidden="true" focusable="false"' + (cls ? ' class="' + cls + '"' : '') + '>' + i[1] + '</svg>';
}
/* 分类图标（双色玫瑰金 sprite：/assets/icons.svg）。颜色通过 CSS 变量 --i1(主体) --i2(细节) --i3(点缀) 覆盖 */
export function cicon(n, cls) { return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="/assets/icons.svg#i-' + n + '"/></svg>'; }
export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
export function $(s, r) { return (r || document).querySelector(s); }
export function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
export function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

// ---- Toast ----
var toastBox;
export function toast(msg, kind, ms) {
  if (!toastBox) { toastBox = el('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.appendChild(toastBox); }
  var t = el('<div class="toast' + (kind === 'err' ? ' err' : '') + '">' + esc(msg) + '</div>');
  toastBox.appendChild(t);
  requestAnimationFrame(function () { requestAnimationFrame(function () { t.classList.add('in'); }); });
  setTimeout(function () { t.classList.remove('in'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300); }, ms || 2600);
}

// ---- Sheet ----
export function sheet(html, opt) {
  opt = opt || {};
  var prev = document.activeElement;
  var s = el('<div class="scrim" role="dialog" aria-modal="true"><div class="sheet" style="position:relative"><button class="ibtn x" aria-label="关闭">' + icon('close') + '</button>' + html + '</div></div>');
  document.body.appendChild(s);
  function close() { s.classList.remove('in'); document.removeEventListener('keydown', key); setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); if (prev && prev.focus) try { prev.focus(); } catch (e) {} if (opt.onClose) opt.onClose(); }, 260); }
  function key(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', key);
  s.addEventListener('click', function (e) { if (e.target === s) close(); });
  $('.x', s).addEventListener('click', close);
  requestAnimationFrame(function () { requestAnimationFrame(function () { s.classList.add('in'); }); });
  var f = $('input,button:not(.x),select', s); if (f && !opt.noFocus) setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) {} }, 300);
  return { el: s, close: close, $: function (q) { return $(q, s); } };
}

// ---- 页眉 / 底部导航 ----
var NAV = [['/', '大厅', 'home'], ['/#sports', '体育', 'sports']];
export function mountShell(active) {
  var sprite = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' + '</defs></svg>';
  var hdr = el('<header class="hdr"><div class="wrap">' +
    '<a class="brand" href="/" aria-label="8K 首页"><span class="mk"><img src="/assets/logo-mark.svg" alt="" width="38" height="38" decoding="async"></span><b>8K</b><small>游戏大厅</small></a>' +
    '<nav class="nav" aria-label="主导航">' + NAV.map(function (n) { return '<a href="' + n[0] + '"' + (active === n[0] ? ' aria-current="page"' : '') + '>' + n[1] + '</a>'; }).join('') + '</nav>' +
    '<button class="acct" id="hdrTx" type="button">交易记录</button><button class="acct" id="hdrMe" type="button" aria-label="我的账户">我的</button>' +
        '<button class="bal" id="balBtn" aria-label="钱包余额，点击充值"><small>演示币</small><b id="balV">--</b><span class="plus">' + icon('plus') + '</span></button>' +
    '</div></header>');
  var ph = document.querySelector('.hdr-ph'); if (ph) ph.parentNode.removeChild(ph);  // 去掉预留占位(避免页眉插入造成布局位移 CLS)
  document.body.insertBefore(hdr, document.body.firstChild);
  var tb = el('<nav class="tabbar" aria-label="底部导航"><ul>' +
    '<li><a href="/"' + (active === '/' ? ' class="on" aria-current="page"' : '') + '>' + icon('home') + '大厅</a></li>' +
    '<li><a href="/#sports">' + icon('sports') + '体育</a></li>' +
    '<li><a href="#" class="mid" id="tbDep" role="button"><span class="orbtn">' + icon('plus') + '</span><em>充值</em></a></li>' +
    '<li><a href="#" id="tbTx" role="button">' + icon('list') + '记录</a></li>' +
    '<li><a href="#" id="tbMe" role="button">' + icon('user') + '我的</a></li>' +
    '</ul></nav>');
  document.body.appendChild(tb);
  var balV = $('#balV');
  onWallet(function (w) { if (w) balV.textContent = fmt(w.balance); });
  $('#balBtn').addEventListener('click', openDeposit);
  $('#tbDep').addEventListener('click', function (e) { e.preventDefault(); openDeposit(); });
  $('#tbTx').addEventListener('click', function (e) { e.preventDefault(); openTx(); });
  $('#tbMe').addEventListener('click', function (e) { e.preventDefault(); openMe(); });
  $('#hdrMe').addEventListener('click', openMe); $('#hdrTx').addEventListener('click', openTx); // 桌面端没有底部导航，账户入口放在页眉
  // 游客可浏览大厅/赛事；充值、记录、我的、下注需要登录
  return api.ensure(true).then(function (r) {
    if (!r) guestHeader(); else { var hm = $('#hdrMe'); hm.textContent = state.user.username; hm.setAttribute('aria-label', '我的账户：' + state.user.username); }
    return api.config().then(maintenanceBanner).catch(function () {});
  }).catch(function (e) { toast(errText(e), 'err'); });
}
function guestHeader() {
  $('#hdrMe').textContent = '登录'; $('#hdrTx').hidden = true;
  var b = $('#balBtn'); b.innerHTML = '<b style="min-width:0;font-style:normal;font-family:inherit;font-size:15px;padding-right:14px">登录 / 注册</b>'; b.setAttribute('aria-label', '登录或注册');
}
// 后台“系统设置”里的站点横幅
function maintenanceBanner(c) {
  var m = c && c.maintenance; if (!m || !m.enabled || !m.text) return;
  var el = document.createElement('div'); el.className = 'mt-banner ' + (m.level === 'warn' ? 'warn' : 'info'); el.setAttribute('role', 'status');
  el.innerHTML = '<span>' + esc(m.text) + (m.blockPlay ? '（维护中，暂时无法开始游戏）' : '') + '</span>';
  var h = document.querySelector('.hdr'); if (h && h.parentNode) h.parentNode.insertBefore(el, h.nextSibling);
}

export function openDeposit() {
  if (!api.requireLogin()) return;
  var s = sheet('<h3>充值 <span class="demo-tag">演示</span></h3><p class="sub">演示币，仅用于体验流程，没有任何真实资金。真实上线需接入支付通道。</p>' +
    '<label for="depA">金额</label><div class="stake"><input id="depA" class="field" inputmode="decimal" value="100" autocomplete="off"></div>' +
    '<div class="row seg" id="depQ">' + [50, 100, 500, 1000].map(function (v) { return '<button type="button" data-v="' + v + '">' + v + '</button>'; }).join('') + '</div>' +
    '<button class="btn btn-foil" id="depGo" type="button">确认充值</button><p class="note" id="depLim"></p>');
  var lim = state.wallet && state.wallet.limits;
  if (lim) s.$('#depLim').textContent = '本地区充值限额：' + (lim.minDeposit != null ? '最低 ' + lim.minDeposit : '无最低') + ' / ' + (lim.maxDeposit != null ? '单笔最高 ' + lim.maxDeposit : '单笔不设上限') + (lim.maxDailyDeposit != null ? ' / 每日最高 ' + lim.maxDailyDeposit : '') + '。';
  s.el.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('#depQ button'); if (b) s.$('#depA').value = b.getAttribute('data-v'); });
  s.$('#depGo').addEventListener('click', function () {
    var v = s.$('#depA').value.replace(/,/g, '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(v) || +v <= 0) return toast('请输入有效金额（最多两位小数）', 'err');
    var b = s.$('#depGo'); b.disabled = true;
    api.deposit(+v).then(function () { toast('充值成功（演示币）'); s.close(); }).catch(function (e) { toast(errText(e), 'err'); b.disabled = false; });
  });
}
var TXN = { adjust: '运营调整', settle: '结算', bet: '投注', win: '派彩', rollback: '冲正', refund: '退款', deposit: '充值(演示)', transfer_in: '转入', transfer_out: '转出' };
export function openTx() {
  if (!api.requireLogin()) return;
  var s = sheet('<h3>交易记录 <span class="demo-tag">演示</span></h3><p class="sub">最近 30 笔，来自 GET /api/transactions</p><div id="txl"><div class="empty">加载中…</div></div>');
  api.transactions(30).then(function (r) {
    var l = r.transactions;
    s.$('#txl').innerHTML = l.length ? l.map(function (e) {
      var neg = e.type === 'bet' || e.type === 'transfer_in' || ((e.type === 'settle' || e.type === 'adjust') && e.amount < 0);
      return '<div class="li"><span>' + esc(TXN[e.type] || e.type) + (e.status === 'rolled_back' ? '（已冲正）' : '') + '<small>' + esc(e.gameId || e.provider) + ' · ' + new Date(e.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) + '</small></span><b class="' + (neg ? 'neg' : 'pos') + '">' + (neg ? '-' : '+') + fmt(Math.abs(e.amount)) + '</b></div>';
    }).join('') : '<div class="empty"><b>暂无记录</b>去大厅玩一局吧</div>';
  }).catch(function (e) { s.$('#txl').innerHTML = '<div class="empty">' + esc(errText(e)) + '</div>'; });
}
export function openMe() {
  if (!api.requireLogin()) return;
  var u = state.user || {};
  var s = sheet('<h3>我的账户 <span class="demo-tag">演示</span></h3><p class="sub">' + esc(u.username || '') + ' · 演示币余额 ' + fmt(state.wallet ? state.wallet.balance : 0) + '</p>' +
    '<div class="row"><button class="btn btn-foil" id="meOut" type="button">退出登录</button></div>' +
    '<div class="row"><a class="btn btn-ghost" href="/login.html?switch=1" style="min-height:44px">切换账号</a></div>' +
    '<label>负责任博彩（桩功能）</label><div class="row"><button class="btn btn-ghost" id="rg1" type="button" style="min-height:44px;width:auto;flex:1">冷静 1 小时</button><button class="btn btn-ghost" id="rg2" type="button" style="min-height:44px;width:auto;flex:1">设每日充值上限 500</button></div>' +
    '<p class="note">18+ 理性游戏。需要帮助请联系当地求助热线（占位，待填写）。自我排除/限额均为演示桩，真实环境需接入合规系统。</p>');
  s.$('#meOut').addEventListener('click', function () { api.logout().then(function () { location.href = '/login.html'; }); });
  s.$('#rg1').addEventListener('click', function () { api.post('/api/rg/exclude', { hours: 1, kind: 'cooloff' }).then(function () { toast('已开启 1 小时冷静期（刷新后投注将被拒绝）'); }).catch(function (e) { toast(errText(e), 'err'); }); });
  s.$('#rg2').addEventListener('click', function () { api.post('/api/rg/limits', { dailyDepositLimit: 500 }).then(function () { toast('已设置每日充值上限 500'); }).catch(function (e) { toast(errText(e), 'err'); }); });
}

export var DEMO_NOTE = '本页所有游戏、赔率、余额、赛事均为示例/演示数据，不涉及真实资金。';
