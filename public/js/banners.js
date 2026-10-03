/* 大厅横幅轮播：原生 scroll-snap（可滑动），仅 JS 负责圆点/箭头/自动轮播。动画仅依赖原生滚动；减少动态/低性能模式下不自动播放。 */
export function initBanners(root, onGo) {
  var track = root.querySelector('.bn-track'); if (!track) return;
  var slides = [].slice.call(track.children), dots = root.querySelector('.bn-dots'), cur = 0, last = 0, timer = 0, vis = true, tick = 0;
  var rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stops() { var max = track.scrollWidth - track.clientWidth, one = track.clientWidth < 1.9 * step(), n = 0; slides.forEach(function (s) { if (one || s.offsetLeft - slides[0].offsetLeft <= max + 2) n++; }); return Math.max(1, n); }
  function step() { return slides.length > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : track.clientWidth; }
  function go(i, smooth) {
    i = Math.max(0, Math.min(stops() - 1, i));
    var left = slides[i].offsetLeft - slides[0].offsetLeft;
    if (smooth && track.scrollTo && !rm) { try { track.scrollTo({ left: left, behavior: 'smooth' }); return; } catch (e) {} }
    track.scrollLeft = left;
  }
  function mark() { slides.forEach(function (s, k) { s.classList.toggle('cur', k === cur); }); [].forEach.call(dots.children, function (b, k) { b.setAttribute('aria-current', k === cur ? 'true' : 'false'); }); }
  function paint() {
    tick = 0;
    var i = Math.round(track.scrollLeft / (step() || 1)); i = Math.max(0, Math.min(stops() - 1, i));
    var max = track.scrollWidth - track.clientWidth;
    if (max > 0 && track.clientWidth < 1.9 * step() && track.scrollLeft >= max - 2 && slides[slides.length - 1].offsetLeft - slides[0].offsetLeft > max + 2) i = slides.length - 1;
    if (i === cur) return; cur = i; mark();
  }
  track.addEventListener('scroll', function () { last = Date.now(); if (!tick) tick = requestAnimationFrame(paint); }, { passive: true });
  function build() { var n = stops(); if (dots.children.length === n) return; if (cur > n - 1) cur = n - 1; dots.innerHTML = slides.slice(0, n).map(function (s, i) { return '<button type="button" aria-label="第 ' + (i + 1) + ' 张" aria-current="' + (i === cur) + '"></button>'; }).join(''); }
  build();
  dots.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; last = Date.now() + 6000; go([].indexOf.call(dots.children, b), true); });
  mark();
  var prev = root.querySelector('.bn-prev'), next = root.querySelector('.bn-next');
  if (prev) prev.addEventListener('click', function () { last = Date.now() + 6000; go(cur - 1, true); });
  if (next) next.addEventListener('click', function () { last = Date.now() + 6000; go(cur + 1 >= stops() ? 0 : cur + 1, true); });
  track.addEventListener('click', function (e) { var a = e.target.closest('a[data-go]'); if (!a) return; e.preventDefault(); if (onGo) onGo(a.getAttribute('data-go')); });
  ['touchstart', 'pointerdown', 'wheel', 'keydown', 'focusin'].forEach(function (ev) { root.addEventListener(ev, function () { last = Date.now() + 8000; }, { passive: true }); });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { vis = es[0].isIntersecting; }, { threshold: .4 }).observe(root);
  var lp = document.documentElement.classList.contains('lp');
  if (!rm && !lp) timer = setInterval(function () {
    if (document.hidden || !vis || Date.now() - last < 5000) return;
    go(cur + 1 >= stops() ? 0 : cur + 1, true);
  }, 5500);
  window.addEventListener('resize', function () { build(); mark(); go(cur, false); });
}
