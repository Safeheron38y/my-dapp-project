/**
 * GameWindow —— 可复用的游戏窗口容器
 *  - 移动端全屏(含安全区)，顶栏：返回 / 标题 / 余额 / 声音 / 全屏
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
    '<div class="gw-top" id="gwTop">' +
    '<button class="ibtn" id="gwBack" aria-label="返回大厅" type="button">' + icon('back') + '</button>' +
    '<div class="gw-ttl"><b>' + esc(opt.title) + '</b><span>' + (opt.demo ? '<span class="demo-tag">演示 DEMO</span>' : '') + (opt.provider ? '<span style="font-size:11px;color:rgba(255,255,255,.75)">' + esc(opt.provider) + '</span>' : '') + '</span></div>' +
    '<div class="bal" aria-label="余额"><small>余额</small><b id="gwBal">--</b></div>' +
    '<button class="ibtn" id="gwSnd" aria-label="声音" aria-pressed="' + (this.muted ? 'false' : 'true') + '" type="button"><span class="on">' + icon('snd') + '</span><span class="off">' + icon('mute') + '</span></button>' +
    '<button class="ibtn" id="gwFs" aria-label="全屏" type="button">' + icon('fs') + '</button>' +
    '</div>' +
    '<div class="gw-body" id="gwBody">' +
    '<div class="gw-bar" id="gwBar" role="alert"></div>' +
    '<div class="slot" id="gwSlot"></div>' +
    '<div class="gw-state" id="gwState"><div class="spin"></div><p id="gwMsg">加载中…</p></div>' +
    '<div class="gw-rot" id="gwRot" hidden>' + icon('rotate') + '<p>此游戏需要横屏体验<br>请旋转您的设备</p><button class="btn btn-ghost" id="gwRotSkip" type="button" style="min-height:44px">仍以竖屏继续</button></div>' +
    '</div></div>');
  document.body.appendChild(this.root);
  document.documentElement.classList.add('gw-open');
  document.body.style.overflow = 'hidden';
  this.slot = $('#gwSlot', this.root);
  this.body = $('#gwBody', this.root);
  this.balEl = $('#gwBal', this.root);
  this.unw = onWallet(function (w) { if (w) self.balEl.textContent = fmt(w.balance); });

  $('#gwBack', this.root).addEventListener('click', function () { self.back(); });
  $('#gwSnd', this.root).addEventListener('click', function () { self.setMuted(!self.muted); });
  $('#gwFs', this.root).addEventListener('click', function () { self.toggleFs(); });
  $('#gwRotSkip', this.root).addEventListener('click', function () { self.rotDismissed = true; self.checkOrientation(); });
  this.on(window, 'resize', function () { self.checkOrientation(); });
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

P.on = function (t, ev, fn) { t.addEventListener(ev, fn); this.listeners.push([t, ev, fn]); };
P.isLandscape = function () { return window.innerWidth > window.innerHeight; };
P.isPhone = function () { return Math.min(window.innerWidth, window.innerHeight) < 700; };
P.checkOrientation = function () {
  var need = this.opt.orientation === 'landscape' && this.isPhone() && !this.isLandscape() && !this.rotDismissed;
  $('#gwRot', this.root).hidden = !need;
};
P.back = function () {
  this.destroy();
  var same = document.referrer && document.referrer.indexOf(location.origin) === 0;
  if (this.opt.onBack) this.opt.onBack();
  if (same && history.length > 1) history.back(); else location.href = this.opt.backHref;
};
P.destroy = function () {
  this.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
  this.listeners = []; if (this.unw) this.unw();
  clearTimeout(this.loadTimer);
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
    (canRetry === false ? '' : '<button class="btn btn-foil" id="gwRetry" type="button">' + icon('refresh') + ' 重新连接</button>') +
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
    self.iframe = f; self.body.insertBefore(f, $('#gwBar', self.root));
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
  $('#gwSnd', this.root).setAttribute('aria-pressed', m ? 'false' : 'true');
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
P.pseudoFs = function () {
  var on = !this.root.classList.contains('imm'), top = $('#gwTop', this.root), self = this;
  this.root.classList.toggle('imm', on); top.classList.remove('show');
  if (on) {
    toast('已进入沉浸模式：轻触屏幕顶部边缘可唤出菜单');
    if (!this.edge) {
      this.edge = el('<div style="position:absolute;left:0;right:0;top:0;height:28px;z-index:6"></div>');
      this.edge.addEventListener('click', function () { top.classList.toggle('show'); });
    }
    this.root.appendChild(this.edge);
  } else if (this.edge && this.edge.parentNode) this.edge.parentNode.removeChild(this.edge);
  this.fsUpdate();
  window.dispatchEvent(new Event('resize'));
};
P.fsUpdate = function () {
  var on = this.fsActive() || this.root.classList.contains('imm');
  var b = $('#gwFs', this.root); b.innerHTML = icon(on ? 'fsx' : 'fs'); b.setAttribute('aria-label', on ? '退出全屏' : '全屏');
  window.dispatchEvent(new Event('resize'));
};
P.setBalance = function (b) { setBalance(b); };
