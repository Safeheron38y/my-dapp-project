import { api, state, fmt, errText } from '../api.js';
import { GameWindow } from '../gamewindow.js';
import { esc, $, toast, icon } from '../ui.js';

export function boot(title, key, build) {
  var gw = new GameWindow({ title: title, orientation: 'any', provider: '8K 自研' });
  gw.opt.onReconnect = function () { init(); };
  function init() {
    gw.showLoading('正在登录…');
    api.ensure().then(function () {
      return api.launch(key); // 走统一启动接口：地区开关/自我排除/限额校验与第三方游戏一致
    }).then(function () { gw.hideState(); build(gw); })
      .catch(function (e) { gw.showError(errText(e), e.code === 'NETWORK' || e.status === 0); });
  }
  init();
  return gw;
}
export function stakeBox(id, val) {
  return '<div class="stake"><button type="button" data-d="half" aria-label="减半">½</button><input class="field" id="' + id + '" inputmode="decimal" value="' + (val || 10) + '" aria-label="投注额" autocomplete="off"><button type="button" data-d="dbl" aria-label="加倍">2×</button></div>';
}
export function bindStake(root, input) {
  root.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.stake button'); if (!b) return;
    var v = parseFloat(input.value) || 0; v = b.getAttribute('data-d') === 'half' ? v / 2 : v * 2;
    input.value = Math.max(0.1, Math.round(v * 100) / 100);
  });
}
export function readStake(input) {
  var s = String(input.value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s) || +s <= 0) { toast('请输入有效投注额（最多两位小数）', 'err'); return null; }
  return +s;
}
export function setRes(el, text, cls) { el.className = 'res' + (cls ? ' ' + cls : ''); el.textContent = text; }
export function pushHist(el, txt, win) {
  var s = document.createElement('span'); s.className = win ? 'w' : 'l'; s.textContent = txt;
  el.insertBefore(s, el.firstChild); while (el.children.length > 12) el.removeChild(el.lastChild);
}
// 简单音效（WebAudio，无外部资源；遵循静音开关）。老浏览器无 AudioContext 则静默。
var ac;
export function beep(freq, ms, vol) {
  if (window.__8kMuted === undefined) window.__8kMuted = localStorage.getItem('8k.muted') === '1';
  if (window.__8kMuted) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') { var rp = ac.resume(); if (rp && rp.catch) rp.catch(function () {}); } // 无音频设备时 resume() 会异步拒绝，吞掉避免未处理的 Promise 错误
    var o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq; o.type = 'sine'; g.gain.value = vol || 0.04;
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + ms / 1000);
  } catch (e) {}
}
export function page(title, bodyHtml) { return bodyHtml; }
