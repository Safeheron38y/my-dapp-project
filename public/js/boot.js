/* 经典脚本（非模块）：特征检测 + 低性能模式标记。老浏览器若不支持 ES 模块，nomodule.js 会给出提示。 */
(function () {
  var d = document, h = d.documentElement, n = navigator, c = ' js';
  try {
    var lp = /[?&]lp=([01])/.exec(location.search);
    var rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var low = rm || (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 2) || !!(n.connection && n.connection.saveData);
    if (lp ? lp[1] === '1' : low) c += ' lp';
  } catch (e) {}
  if (!window.CSS || !CSS.supports || !CSS.supports('height', '100dvh')) c += ' no-dvh';
  // 旧内核能力探测：flex-gap(iOS<14.5 / WebView<84) 与 aspect-ratio(iOS<15 / WebView<88)。不支持时才加载 /css/compat.css(自动生成的回退样式)
  var fg = true, ar = !!(window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1/1'));
  try {
    var t = d.createElement('div'); t.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden;pointer-events:none';
    t.appendChild(d.createElement('i')); t.appendChild(d.createElement('i')); h.appendChild(t); fg = t.scrollHeight === 1; h.removeChild(t);
  } catch (e) {}
  if (!fg) c += ' no-fg'; if (!ar) c += ' no-ar';
  if (!fg || !ar) d.write('<link rel="stylesheet" href="/css/compat.css">');
  h.className += c;
  // iOS 视口高度变量(--vh)：为不支持 dvh 的旧浏览器兜底
  function vh() { h.style.setProperty('--vh', window.innerHeight * 0.01 + 'px'); }
  vh(); window.addEventListener('resize', vh); if (window.visualViewport) window.visualViewport.addEventListener('resize', vh); window.addEventListener('orientationchange', function () { setTimeout(vh, 250); });
})();
