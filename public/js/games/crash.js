/* Crash 演示：服务端 mock RNG 决定崩盘点（仅崩盘后揭示）；前端按服务端时间同步绘制。⚠ 演示，非 provably-fair。 */
import { api, fmt, errText } from '../api.js';
import { boot, stakeBox, bindStake, readStake, setRes, pushHist, beep } from './common.js';
import { $, toast } from '../ui.js';

boot('Crash 火箭', 'crash', function (gw) {
  gw.slot.innerHTML = '<div class="gm"><div class="stage" id="stage"><canvas id="cv" aria-label="Crash 曲线图"></canvas><div class="big-mult" id="mult">1.00×<small id="sub">下注开始新回合</small></div><span class="wm">演示 DEMO · MOCK RNG</span></div>' +
    '<div class="panel"><div><h4>投注额（演示币）</h4>' + stakeBox('amt', 10) + '</div>' +
    '<button class="btn btn-foil btn-lg" id="go" type="button">下注并起飞</button>' +
    '<div class="res" id="res" aria-live="polite"></div><div><h4>最近结果</h4><div class="hist" id="hist"></div></div>' +
    '<p style="font-size:11px;color:rgba(255,255,255,.7);line-height:1.6">演示用途：回合结果由服务端 mock RNG 生成，没有公平性证明，也未经认证。上线需替换为认证的 RNG/供应商。</p></div></div>';
  var cv = $('#cv'), ctx = cv.getContext('2d'), mult = $('#mult'), sub = $('#sub'), go = $('#go'), res = $('#res'), hist = $('#hist'), amt = $('#amt');
  bindStake(gw.slot, amt);
  var dpr = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0;
  function size() { var r = cv.parentNode.getBoundingClientRect(); W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  var round = null, state = 'idle', raf = 0, skew = 0, GROWTH = 0.00006, crashed = null, cur = 1, pollT = 0;
  function nowSrv() { return Date.now() + skew; }
  function mAt(ms) { return ms <= 0 ? 1 : Math.floor(Math.exp(GROWTH * ms) * 100) / 100; }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    var pad = 22;
    ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var i = 1; i < 5; i++) { var y = pad + (H - pad * 2) * i / 5; ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); } ctx.stroke();
    if (state === 'idle' && !crashed) return;
    var t = round ? Math.max(0, nowSrv() - round.startAt) : 0;
    var tMax = Math.max(6000, t * 1.15), mMax = Math.max(2, mAt(tMax) * 1.05);
    var pts = 40, x0 = pad, y0 = H - pad, sw = W - pad * 2, sh = H - pad * 2;
    var grad = ctx.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#7A5BE0'); grad.addColorStop(1, crashed ? '#ff9a76' : '#F7D3C4');
    ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.strokeStyle = grad; ctx.beginPath();
    var lx = x0, ly = y0;
    for (var k = 0; k <= pts; k++) {
      var tk = t * k / pts, m = Math.exp(GROWTH * tk), x = x0 + sw * (tk / tMax), y = y0 - sh * ((m - 1) / (mMax - 1));
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); lx = x; ly = y;
    }
    ctx.stroke();
    ctx.lineTo(lx, y0); ctx.lineTo(x0, y0); ctx.closePath(); ctx.fillStyle = 'rgba(194,71,138,.18)'; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 8, 0, 7); ctx.fillStyle = crashed ? '#ff9a76' : '#fff'; ctx.fill();
  }
  function setMult(v, cls, s) { mult.firstChild.nodeValue = v.toFixed(2) + '×'; mult.className = 'big-mult' + (cls ? ' ' + cls : ''); if (s !== undefined) sub.textContent = s; }
  function tick() {
    if (state !== 'flying' && state !== 'countdown') return;
    var ms = nowSrv() - round.startAt;
    if (ms < 0) { setMult(1, '', '起飞倒计时 ' + Math.ceil(-ms / 1000) + ' 秒'); }
    else { state = 'flying'; cur = mAt(ms); setMult(cur, '', '点击「提现」锁定收益'); go.textContent = '提现 ' + fmt(round.bet * cur) + '（' + cur.toFixed(2) + '×）'; go.classList.remove('dis'); }
    draw(); raf = requestAnimationFrame(tick);
  }
  function poll() {
    clearTimeout(pollT);
    if (state !== 'flying' && state !== 'countdown') return;
    api.get('/api/inhouse/crash/poll?roundId=' + round.id).then(function (r) {
      if (state !== 'flying' && state !== 'countdown') return;
      if (r.state === 'done') return end(r);
      pollT = setTimeout(poll, 350);
    }).catch(function () { pollT = setTimeout(poll, 1200); });
  }
  function end(r) {
    cancelAnimationFrame(raf); clearTimeout(pollT);
    crashed = r.crashPoint; state = 'idle'; setMult(r.crashPoint, 'crashed', '崩盘！'); draw(); beep(140, 300, 0.06);
    setRes(res, '已崩盘于 ' + r.crashPoint.toFixed(2) + '×，本局未提现', 'lose'); pushHist(hist, r.crashPoint.toFixed(2) + '×', false);
    go.textContent = '下注并起飞'; go.classList.remove('dis'); go.disabled = false; round = null; api.wallet().catch(function () {});
  }
  go.addEventListener('click', function () {
    if (go.disabled) return;
    if (state === 'idle') {
      var a = readStake(amt); if (a == null) return;
      go.disabled = true; crashed = null; setRes(res, '');
      api.inhouse('crash', 'start', { amount: a }).then(function (r) {
        round = { id: r.roundId, startAt: r.startAt, bet: a }; skew = r.serverNow - Date.now(); GROWTH = r.growth;
        state = 'countdown'; go.textContent = '等待起飞…'; go.classList.add('dis'); go.disabled = false; setMult(1, '', ''); beep(520, 120);
        raf = requestAnimationFrame(tick); poll();
      }).catch(function (e) { go.disabled = false; toast(errText(e), 'err'); });
    } else if (state === 'flying') {
      go.disabled = true; var rid = round.id;
      api.inhouse('crash', 'cashout', { roundId: rid }).then(function (r) {
        cancelAnimationFrame(raf); clearTimeout(pollT);
        if (r.result === 'crashed') return end({ crashPoint: r.crashPoint });
        state = 'idle'; setMult(r.multiplier, 'cashed', '已提现'); beep(880, 200);
        setRes(res, '提现成功 ' + r.multiplier.toFixed(2) + '×，赢得 ' + fmt(r.payout), 'win'); pushHist(hist, r.multiplier.toFixed(2) + '×', true);
        go.textContent = '下注并起飞'; go.disabled = false; round = null;
      }).catch(function (e) { go.disabled = false; toast(errText(e), 'err'); });
    }
  });
  window.addEventListener('resize', size); size();
  // 断线重连/切后台：回到前台后校正
  gw.opt.onVisibility = function (hidden) { if (!hidden && round) { poll(); } };
});
