/* 大厅横幅轮播：原生 scroll-snap（可滑动、iOS/Android 惯性滚动），每次只显示一张完整的横幅（不露出下一张）。
   JS 只负责：圆点/箭头、自动轮播（约 4 秒）、触摸/悬停/聚焦时暂停、页面不可见或轮播离开视口时暂停。
   prefers-reduced-motion: reduce 时不自动播放（仍可手动滑动/点圆点）。注意：不再因“低性能模式”(.lp) 关闭自动播放。 */
export function initBanners(root, onGo) {
  var track = root.querySelector('.bn-track'); if (!track) return;
  var slides = [].slice.call(track.querySelectorAll('.bn-slide')), n = slides.length, dots = root.querySelector('.bn-dots');
  var cur = 0, target = null, tgTimer = 0, timer = 0, holdUntil = 0, hovering = false, touching = false, vis = true, raf = 0;
  var INTERVAL = 4000;
  var mq = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  var reduce = function () { return !!(mq && mq.matches); };

  function width() { return track.clientWidth || 1; }
  function indexNow() { return Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / width()))); }
  function mark() {
    slides.forEach(function (s, k) { s.classList.toggle('cur', k === cur); s.setAttribute('aria-hidden', k === cur ? 'false' : 'true'); });
    [].forEach.call(dots.children, function (b, k) { b.setAttribute('aria-current', k === cur ? 'true' : 'false'); });
  }
  function go(i, smooth) {
    i = (i + n) % n;
    var left = i * width();
    if (smooth && !reduce() && track.scrollTo) { try { track.scrollTo({ left: left, behavior: 'smooth' }); } catch (e) { track.scrollLeft = left; } }
    else track.scrollLeft = left;
    cur = i; mark();   // 立即更新圆点
    target = left; clearTimeout(tgTimer); tgTimer = setTimeout(function () { target = null; }, 1000); // 程序化滚动期间不让中间位置把圆点改回去
  }
  function free() { target = null; }
  function onScroll() {
    if (target != null) { if (Math.abs(track.scrollLeft - target) > 2) return; target = null; }
    if (raf) return; raf = requestAnimationFrame(function () { raf = 0; var i = indexNow(); if (i !== cur) { cur = i; mark(); } });
  }
  track.addEventListener('scroll', onScroll, { passive: true });

  dots.innerHTML = slides.map(function (s, i) { return '<button type="button" aria-label="第 ' + (i + 1) + ' 张"></button>'; }).join('');
  dots.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; hold(); go([].indexOf.call(dots.children, b), true); });
  var prev = root.querySelector('.bn-prev'), next = root.querySelector('.bn-next');
  if (prev) prev.addEventListener('click', function () { hold(); go(cur - 1, true); });
  if (next) next.addEventListener('click', function () { hold(); go(cur + 1, true); });
  track.addEventListener('click', function (e) { var a = e.target.closest('a[data-go]'); if (!a) return; e.preventDefault(); if (onGo) onGo(a.getAttribute('data-go')); });
  track.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { hold(); go(cur + 1, true); e.preventDefault(); } else if (e.key === 'ArrowLeft') { hold(); go(cur - 1, true); e.preventDefault(); } });

  /* ---- 自动轮播 ---- */
  function hold(ms) { holdUntil = Date.now() + (ms || INTERVAL); }       // 用户交互后：再等一个完整周期才继续
  function paused() { return touching || hovering || document.hidden || !vis || Date.now() < holdUntil || reduce(); }
  function tick() { if (!paused()) go(cur + 1, true); }
  function start() { stop(); if (!reduce() && n > 1) timer = setInterval(tick, INTERVAL); }
  function stop() { if (timer) { clearInterval(timer); timer = 0; } }
  // 触摸 / 指针按下：暂停；松开后再等一个周期
  track.addEventListener('touchstart', function () { touching = true; free(); }, { passive: true });
  track.addEventListener('wheel', free, { passive: true });
  ['touchend', 'touchcancel'].forEach(function (ev) { track.addEventListener(ev, function () { touching = false; hold(); }, { passive: true }); });
  track.addEventListener('pointerdown', function (e) { free(); if (e.pointerType === 'mouse') hold(); }, { passive: true });
  root.addEventListener('mouseenter', function () { hovering = true; });
  root.addEventListener('mouseleave', function () { hovering = false; hold(1500); });
  root.addEventListener('focusin', function () { hovering = true; });
  root.addEventListener('focusout', function () { hovering = false; hold(1500); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) hold(1500); });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { vis = es[0].isIntersecting; if (vis) hold(1500); }, { threshold: .3 }).observe(root);
  if (mq && mq.addEventListener) mq.addEventListener('change', start);
  // 尺寸变化（旋转屏幕 / 地址栏收放）后保持当前张对齐
  var rz = 0; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { track.scrollLeft = cur * width(); }, 120); });
  mark(); start();
}
