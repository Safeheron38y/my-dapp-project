/**
 * GameWindow —— 可复用的游戏窗口容器
 *  - 沉浸式：iframe 铺满整个视口(position:fixed; inset:0; 100dvh; viewport-fit=cover，延伸到刘海/Home 条下)；
 *    唯一的宿主 UI 是左上角半透明圆形返回钮(3 秒后自动变淡，轻触左上角唤回)；无顶栏/无占位条。
 *  - slot: iframe: 供应商游戏，带 postMessage 桥
 *  - 状态：加载中 / 出错(含重连) / 离线横幅 / 横屏提示
 *  - 方向：orientation = 'landscape' | 'portrait' | 'any'
 *
 * postMessage 协议（宿主 <-> 供应商 iframe），详见 API.md「前端 postMessage 桥」：
 *   消息格式 { source:'8k', v:1, type, id?, payload? }
 *   iframe → 宿主：ready / loaded / error / getBalance / roundStart / roundEnd / close / requestFullscreen / log
 *   宿主 → iframe：init / balance / sound / visibility / orientation / pong
 * 安全：只接受 event.source === iframe.contentWindow 且 event.origin ∈ allowedOrigins 的消息。
 */
import { api, state, onWallet, fmt, store, setBalance } from './api.js';
import { icon, esc, $, el, toast } from './ui.js';

var LOAD_TIMEOUT = 20000;

export function GameWindow(opt) {
  var self = this;
  this.opt = opt = Object.assign({ title: '游戏', orientation: 'any', demo: true, provider: '', backHref: '/', hint: '' }, opt || {});
  this.muted = store('muted') === '1';
  this.listeners = [];
  this.fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  this.root = el('<div class="gw" role="main">' +
    '<div class="gw-body" id="gwBody">' +
    '<div class="slot" id="gwSlot"></div>' +
    '<div class="gw-state" id="gwState"><div class="spin"></div><p id="gwMsg">加载中…</p></div>' +
    '<div class="gw-rot" id="gwRot" hidden>' + icon('rotate') + '<p>此游戏需要横屏体验<br>请旋转您的设备</p><button class="btn btn-ghost" id="gwRotSkip" type="button" style="min-height:44px">仍以竖屏继续</button></div>' +
    '</div>' +
    '<div class="gw-bar" id="gwBar" role="alert"></div>' +
    '<button class="gw-back" id="gwBack" aria-label="返回" type="button"><span>' + icon('back') + '</span></button>' +
    '</div>');
  document.body.appendChild(this.root);
  document.documentElement.classList.add('gw-open');
  document.body.style.overflow = 'hidden';
  this.slot = $('#gwSlot', this.root);
  this.body = $('#gwBody', this.root);

  // 返回钮：变淡状态下的第一次轻触只“唤回”，再次轻触才返回（避免误触退出游戏）
  this.backBtn = $('#gwBack', this.root);
  this.backBtn.addEventListener('click', function (e) {
    if (self.wasDim) { self.wasDim = false; e.preventDefault(); self.wakeBack(); return; }
    self.back();
  });
  this.backBtn.addEventListener('pointerdown', function () { self.wasDim = self.backBtn.classList.contains('dim'); self.wakeBack(); });
  this.on(document, 'touchmove', function (e) { if (!self.slot.contains(e.target)) e.preventDefault(); }, { passive: false });
  this.wakeBack();
  $('#gwRotSkip', this.root).addEventListener('click', function () { self.rotDismissed = true; self.checkOrientation(); });
  this.on(window, 'resize', function () { self.checkOrientation(); });
  // 地址栏收起/展开：visualViewport 变化时同步 --vh（不支持 dvh 的旧浏览器的回退），并让页面回到 (0,0)
  if (window.visualViewport) this.on(window.visualViewport, 'resize', function () { document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px'); if (window.scrollY || window.scrollX) window.scrollTo(0, 0); });
  this.on(window, 'orientationchange', function () { setTimeout(function () { self.checkOrientation(); self.post('orientation', { landscape: self.isLandscape() }); }, 250); });
  this.on(document, 'visibilitychange', function () { self.post('visibility', { hidden: document.hidden }); if (self.opt.onVisibility) self.opt.onVisibility(document.hidden); });
  this.on(window, 'offline', function () { self.banner('网络已断开，正在等待恢复…'); });
  this.on(window, 'online', function () { self.banner(''); toast('网络已恢复'); api.wallet().catch(function () {}); if (self.errored) self.reconnect(); });
  this.on(document, 'fullscreenchange', function () { self.fsUpdate(); });
  this.on(document, 'webkitfullscreenchange', function () { self.fsUpdate(); });
  this.on(window, 'message', function (e) { self.onMessage(e); });
  this.checkOrientation();
}
var P = GameWindow.prototype;

P.on = function (t, ev, fn, o) { t.addEventListener(ev, fn, o); this.listeners.push([t, ev, fn, o]); };
// 返回钮：显示后 3 秒自动变淡（不隐藏，仍可轻触唤回）
P.wakeBack = function () {
  var b = this.backBtn, self = this; if (!b) return;
  b.classList.remove('dim'); clearTimeout(this.dimTimer);
  this.dimTimer = setTimeout(function () { b.classList.add('dim'); }, 3000);
};
P.isLandscape = function () { return window.innerWidth > window.innerHeight; };
P.isPhone = function () { return Math.min(window.innerWidth, window.innerHeight) < 700; };
P.checkOrientation = function () {
  var need = this.opt.orientation === 'landscape' && this.isPhone() && !this.isLandscape() && !this.rotDismissed;
  $('#gwRot', this.root).hidden = !need;
};
P.back = function () {
  var href = this.opt.backHref || '/';
  this.destroy();
  if (this.opt.onBack) this.opt.onBack();
  // 仅当上一页是本站(从大厅点进来)时 history.back()；否则(新开标签/外链/无历史)跳首页
  var same = document.referrer && document.referrer.indexOf(location.origin) === 0;
  if (same && history.length > 1) {
    history.back();
    // 兜底：历史记录无法回退(例如新开标签页)时跳转首页
    setTimeout(function () { if (document.visibilityState !== 'hidden') location.href = href; }, 900);
  } else location.href = href;
};
P.destroy = function () {
  this.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
  this.listeners = []; if (this.unw) this.unw();
  clearTimeout(this.loadTimer); clearTimeout(this.dimTimer);
  try { if (this.fsActive()) this.exitFs(); } catch (e) {}
  try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
  document.documentElement.classList.remove('gw-open'); document.body.style.overflow = '';
  if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
};
P.banner = function (msg) { var b = $('#gwBar', this.root); b.textContent = msg; b.classList.toggle('in', !!msg); };

/* ---- 状态 ---- */
P.showLoading = function (msg) {
  var s = $('#gwState', this.root); s.hidden = false; this.errored = false;
  s.innerHTML = '<div class="spin"></div><p>' + esc(msg || '加载中…') + '</p>';
};
P.showError = function (msg, canRetry) {
  var self = this; clearTimeout(this.loadTimer); this.errored = true;
  var s = $('#gwState', this.root); s.hidden = false;
  s.innerHTML = '<p style="font-size:18px;font-weight:800">无法加载游戏</p><p>' + esc(msg || '请检查网络后重试') + '</p>' +
    (canRetry === false ? '' : '<button class="btn btn-jade" id="gwRetry" type="button">' + icon('refresh') + ' 重新连接</button>') +
    '<button class="btn btn-ghost" id="gwBack2" type="button">返回大厅</button>';
  var r = $('#gwRetry', s); if (r) r.addEventListener('click', function () { self.reconnect(); });
  $('#gwBack2', s).addEventListener('click', function () { self.back(); });
};
P.hideState = function () { $('#gwState', this.root).hidden = true; this.errored = false; clearTimeout(this.loadTimer); };

/* ---- iframe 供应商游戏 ---- */
// getLaunch: () => Promise<{url, ...}>；每次重连都会重新调用以获取新的 token
P.loadIframe = function (getLaunch) {
  var self = this; this.getLaunch = getLaunch; this.loaded = false;
  this.showLoading('正在启动游戏…');
  return getLaunch().then(function (r) {
    self.launch = r;
    if (!r.url) throw new Error('供应商未返回游戏地址');
    var u = new URL(r.url, location.href);
    self.allowed = [u.origin].concat(r.allowedOrigins || []);
    if (self.iframe && self.iframe.parentNode) self.iframe.parentNode.removeChild(self.iframe);
    var f = document.createElement('iframe');
    f.setAttribute('title', self.opt.title);
    f.setAttribute('allow', 'autoplay; fullscreen; clipboard-write; encrypted-media');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'origin');
    // 同源演示游戏需要 allow-same-origin 才能读 localStorage 等；真实供应商是跨域，不会获得本站权限
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    f.addEventListener('load', function () { if (!self.readyMsg) self.hideState(); self.loaded = true; self.post('init', self.initPayload()); });
    f.addEventListener('error', function () { self.showError('游戏页面加载失败'); });
    self.iframe = f; self.body.insertBefore(f, self.body.firstChild);
    f.src = u.href;
    self.readyMsg = false;
    clearTimeout(self.loadTimer);
    self.loadTimer = setTimeout(function () { if (!self.loaded) self.showError('连接超时，供应商响应较慢'); }, LOAD_TIMEOUT);
  }).catch(function (e) { self.showError(e && e.message ? e.message : '启动失败'); });
};
P.initPayload = function () {
  return { token: this.launch && this.launch.launchToken, balance: state.wallet && state.wallet.balance, currency: state.wallet && state.wallet.currency, lang: 'zh-CN', muted: this.muted, landscape: this.isLandscape() };
};
P.reconnect = function () { if (this.getLaunch) return this.loadIframe(this.getLaunch); if (this.opt.onReconnect) this.opt.onReconnect(); };
P.post = function (type, payload, id) {
  if (!this.iframe || !this.iframe.contentWindow || !this.allowed) return;
  var origin = this.allowed[0];
  try { this.iframe.contentWindow.postMessage({ source: '8k', v: 1, type: type, id: id, payload: payload }, origin); } catch (e) {}
};
P.onMessage = function (e) {
  if (!this.iframe || e.source !== this.iframe.contentWindow) return;
  if (this.allowed.indexOf(e.origin) < 0) { console.warn('[GameWindow] 丢弃未授权来源消息', e.origin); return; }
  var d = e.data; if (!d || d.source !== '8k') { if (this.opt.onRawMessage) this.opt.onRawMessage(e); return; }
  var self = this, p = d.payload || {};
  switch (d.type) {
    case 'ready': this.readyMsg = true; this.loaded = true; this.hideState(); this.post('init', this.initPayload()); break;
    case 'loaded': this.loaded = true; this.hideState(); break;
    case 'error': this.showError(p.message || '游戏运行出错'); break;
    case 'getBalance': api.wallet().then(function (w) { self.post('balance', { balance: w.balance, currency: w.currency }, d.id); }).catch(function () { self.post('balance', { error: true }, d.id); }); break;
    case 'roundStart': case 'roundEnd': api.wallet().catch(function () {}); break; // 共享钱包：以服务端余额为准
    case 'close': this.back(); break;
    case 'requestFullscreen': this.toggleFs(); break;
    case 'log': if (window.console) console.log('[provider]', p); break;
    default: break;
  }
  if (this.opt.onMessage) this.opt.onMessage(d, e);
};

/* ---- 声音 / 全屏 ---- */
P.setMuted = function (m) {
  this.muted = m; store('muted', m ? '1' : '0');
  window.__8kMuted = m; this.post('sound', { muted: m });
  if (this.opt.onMute) this.opt.onMute(m);
};
P.fsActive = function () { return !!(document.fullscreenElement || document.webkitFullscreenElement); };
P.exitFs = function () { (document.exitFullscreen || document.webkitExitFullscreen).call(document); };
P.toggleFs = function () {
  var self = this, root = this.root;
  if (this.fsSupported) {
    if (this.fsActive()) return this.exitFs();
    var p = (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    if (p && p.then) p.then(function () { return self.lockLandscape(); }).catch(function () { self.pseudoFs(); });
    else this.lockLandscape();
  } else this.pseudoFs(); // iPhone Safari 不支持元素全屏：退化为“沉浸模式”(收起顶栏)
};
P.lockLandscape = function () {
  if (this.opt.orientation !== 'landscape') return;
  try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {}
};
P.pseudoFs = function () { /* 已是沉浸式全屏：无顶栏可收起 */ };
P.fsUpdate = function () { window.dispatchEvent(new Event('resize')); };
P.setBalance = function (b) { setBalance(b); };
