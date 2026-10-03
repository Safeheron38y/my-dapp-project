/* Plinko 演示：服务端 mock RNG 给出落点路径，前端用路径驱动小球动画（transform 绘制于 canvas）。⚠ 演示。 */
import { api, fmt, errText } from '../api.js';
import { boot, stakeBox, bindStake, readStake, setRes, pushHist, beep } from './common.js';
import { $, toast } from '../ui.js';

boot('Plinko 弹珠', 'plinko', function (gw) {
  gw.slot.innerHTML = '<div class="gm"><div class="stage"><canvas id="cv" aria-label="Plinko 弹珠台"></canvas><span class="wm">演示 DEMO · MOCK RNG</span></div>' +
    '<div class="panel"><div><h4>投注额（演示币）</h4>' + stakeBox('amt', 10) + '</div>' +
    '<div><h4>行数</h4><div class="seg" id="rows"><button type="button" data-v="8" aria-pressed="false">8</button><button type="button" data-v="12" aria-pressed="true">12</button><button type="button" data-v="16" aria-pressed="false">16</button></div></div>' +
    '<div><h4>风险</h4><div class="seg" id="risk"><button type="button" data-v="low" aria-pressed="false">低</button><button type="button" data-v="med" aria-pressed="true">中</button><button type="button" data-v="high" aria-pressed="false">高</button></div></div>' +
    '<button class="btn btn-foil btn-lg" id="go" type="button">投下弹珠</button><div class="res" id="res" aria-live="polite"></div>' +
    '<div><h4>最近结果</h4><div class="hist" id="hist"></div></div>' +
    '<p style="font-size:11px;color:rgba(255,255,255,.7);line-height:1.6">演示用途：落点由服务端 mock RNG 生成并立即结算，动画仅为表现。非 provably-fair。</p></div></div>';
  var cv = $('#cv'), ctx = cv.getContext('2d'), go = $('#go'), res = $('#res'), hist = $('#hist'), amt = $('#amt');
  bindStake(gw.slot, amt);
  var rows = 12, risk = 'med', table = null, W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2), balls = [], raf = 0, hl = -1, hlT = 0;
  function seg(id, set) { $('#' + id).addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; Array.prototype.forEach.call(this.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); set(b.getAttribute('data-v')); draw(); }); }
  seg('rows', function (v) { rows = +v; }); seg('risk', function (v) { risk = v; });
  api.get('/api/inhouse/plinko/table').then(function (r) { table = r.table; draw(); });
  function geom() { var padT = 24, padB = 44, gx = Math.min((W - 24) / (rows + 1), 34), gy = (H - padT - padB) / (rows + 0.5); return { gx: gx, gy: gy, padT: padT, cx: W / 2 }; }
  function pegPos(r, i, g) { return [g.cx + (i - r / 2) * g.gx, g.padT + r * g.gy]; }
  function draw() {
    if (!W) return; ctx.clearRect(0, 0, W, H); var g = geom();
    ctx.fillStyle = 'rgba(247,211,196,.85)';
    for (var r = 1; r <= rows; r++) for (var i = 0; i <= r; i++) { var p = pegPos(r, i, g); ctx.beginPath(); ctx.arc(p[0], p[1], 2.6, 0, 7); ctx.fill(); }
    var m = table && table[risk][rows]; if (!m) return;
    var bw = g.gx - 3, by = g.padT + (rows + 0.6) * g.gy; ctx.font = '700 ' + Math.max(8, Math.min(11, bw * .42)) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var k = 0; k <= rows; k++) {
      var x = g.cx + (k - rows / 2) * g.gx, t = m[k], hot = k === hl;
      ctx.fillStyle = hot ? '#fff' : t >= 3 ? '#ff9a76' : t >= 1 ? '#C2478A' : '#5B3CC4';
      rr(x - bw / 2, by, bw, 24, 6); ctx.fill();
      ctx.fillStyle = hot ? '#2B1B5E' : '#fff'; ctx.fillText((t >= 100 ? Math.round(t) : t) + '', x, by + 12);
    }
    balls.forEach(function (b) { ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, 7); ctx.fillStyle = '#fff'; ctx.shadowColor = '#ff9a76'; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0; });
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function size() { var r = cv.parentNode.getBoundingClientRect(); W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function anim() {
    var now = performance.now(), alive = false;
    balls.forEach(function (b) {
      var t = (now - b.t0) / b.dur, g = geom(); if (t >= 1) { t = 1; if (!b.done) { b.done = true; b.cb(); } }
      var f = t * rows, r = Math.min(rows, Math.floor(f)), u = f - r;
      var k0 = 0; for (var i = 0; i < r; i++) k0 += b.path[i];
      var k1 = k0 + (r < rows ? b.path[r] : 0);
      var p0 = r === 0 ? [g.cx, g.padT - 10] : pegPos(r, k0, g), p1 = r < rows ? pegPos(r + 1, k1, g) : [g.cx + (k0 - rows / 2) * g.gx, g.padT + (rows + .6) * g.gy + 12];
      var e = u * u * (3 - 2 * u); b.x = p0[0] + (p1[0] - p0[0]) * e; b.y = p0[1] + (p1[1] - p0[1]) * e - Math.sin(u * Math.PI) * 5;
      if (t < 1) alive = true;
    });
    balls = balls.filter(function (b) { return !b.done || now - b.t0 < b.dur + 200; });
    draw(); if (alive || balls.length) raf = requestAnimationFrame(anim); else raf = 0;
  }
  go.addEventListener('click', function () {
    if (go.disabled) return; var a = readStake(amt); if (a == null) return; go.disabled = true;
    api.inhouse('plinko', 'drop', { amount: a, rows: rows, risk: risk }).then(function (r) {
      beep(600, 80);
      balls.push({ path: r.path, t0: performance.now(), dur: 900 + rows * 90, x: 0, y: 0, cb: function () {
        hl = r.slot; clearTimeout(hlT); hlT = setTimeout(function () { hl = -1; draw(); }, 900);
        var w = r.payout > a; beep(w ? 880 : 300, 160);
        setRes(res, r.multiplier + '× · ' + (r.payout >= a ? '赢得 ' : '返还 ') + fmt(r.payout), w ? 'win' : 'lose'); pushHist(hist, r.multiplier + '×', w); go.disabled = false;
      } });
      if (!raf) raf = requestAnimationFrame(anim);
    }).catch(function (e) { go.disabled = false; toast(errText(e), 'err'); });
  });
  window.addEventListener('resize', size); size();
});
