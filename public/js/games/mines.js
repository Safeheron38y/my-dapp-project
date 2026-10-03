/* Mines 演示：5×5，服务端持有地雷位置，逐格揭示；前端 DOM 翻牌（transform）。⚠ 演示，非 provably-fair。 */
import { api, fmt, errText } from '../api.js';
import { boot, stakeBox, bindStake, readStake, setRes, pushHist, beep } from './common.js';
import { $, toast, icon } from '../ui.js';

boot('Mines 扫雷', 'mines', function (gw) {
  var cells = ''; for (var i = 0; i < 25; i++) cells += '<button class="cell" type="button" data-i="' + i + '" aria-label="第 ' + (i + 1) + ' 格"><i class="f"></i><i class="b"></i></button>';
  gw.slot.innerHTML = '<div class="gm"><div class="stage"><div class="mgrid" id="mg">' + cells + '</div><span class="wm">演示 DEMO · MOCK RNG</span></div>' +
    '<div class="panel"><div><h4>投注额（演示币）</h4>' + stakeBox('amt', 10) + '</div>' +
    '<div><h4>地雷数量</h4><div class="seg" id="mn">' + [1, 3, 5, 10, 24].map(function (n) { return '<button type="button" data-v="' + n + '" aria-pressed="' + (n === 3) + '">' + n + '</button>'; }).join('') + '</div></div>' +
    '<button class="btn btn-foil btn-lg" id="go" type="button">开始游戏</button>' +
    '<div class="res" id="res" aria-live="polite">选择地雷数后开始，逐格翻开，随时提现</div>' +
    '<div><h4>最近结果</h4><div class="hist" id="hist"></div></div>' +
    '<p style="font-size:11px;color:rgba(255,255,255,.7);line-height:1.6">演示用途：地雷位置由服务端 mock RNG 生成并仅在结束后揭示。非 provably-fair。</p></div></div>';
  var mg = $('#mg'), go = $('#go'), res = $('#res'), hist = $('#hist'), amt = $('#amt'), mines = 3, round = null, busy = false, bet = 0;
  var els = Array.prototype.slice.call(mg.children);
  bindStake(gw.slot, amt);
  var GEM = icon('gem'), BOMB = icon('bomb');
  $('#mn').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || round) return; Array.prototype.forEach.call(this.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); mines = +b.getAttribute('data-v'); });
  function reset() { els.forEach(function (c) { c.className = 'cell'; c.querySelector('.b').innerHTML = ''; }); }
  function lock(on) { amt.disabled = on; Array.prototype.forEach.call($('#mn').children, function (b) { b.disabled = on; }); }
  function reveal(bombs, hitIdx) { bombs.forEach(function (i) { var c = els[i]; if (!c.classList.contains('safe')) { c.classList.add('bomb'); if (i !== hitIdx) c.classList.add('ghost'); c.querySelector('.b').innerHTML = BOMB; } }); }
  function finish(win, msg, mult) { round = null; lock(false); go.textContent = '再来一局'; go.disabled = false; setRes(res, msg, win ? 'win' : 'lose'); pushHist(hist, win ? mult.toFixed(2) + '×' : '💥', win); }
  function setCash(m, n) { go.textContent = '提现 ' + fmt(bet * m) + '（' + m.toFixed(2) + '×）'; go.disabled = false; setRes(res, '已翻开 ' + n + ' 格；下一格 ' + (n ? '' : '') + '倍率 ' + (round.next ? round.next.toFixed(2) + '×' : '—'), ''); }
  function applyState(s) { // 重连恢复
    round = { id: s.roundId, next: null }; bet = s.bet; mines = s.mines; lock(true);
    s.opened.forEach(function (i) { els[i].classList.add('safe'); els[i].querySelector('.b').innerHTML = GEM; });
    if (s.opened.length) setCash(s.multiplier, s.opened.length); else { go.textContent = '先翻开一格'; go.disabled = true; setRes(res, '已恢复进行中的回合', ''); }
  }
  api.get('/api/inhouse/mines/state').then(function (s) { if (s.active) applyState(s); }).catch(function () {});
  go.addEventListener('click', function () {
    if (busy) return; busy = true;
    if (!round) {
      var a = readStake(amt); if (a == null) { busy = false; return; }
      api.inhouse('mines', 'start', { amount: a, mines: mines }).then(function (r) {
        reset(); round = { id: r.roundId, next: r.next }; bet = a; lock(true); go.textContent = '先翻开一格'; go.disabled = true; setRes(res, '首格倍率 ' + r.next.toFixed(2) + '×', ''); beep(520, 100);
      }).catch(function (e) { toast(errText(e), 'err'); }).then(function () { busy = false; });
    } else {
      api.inhouse('mines', 'cashout', { roundId: round.id }).then(function (r) {
        reveal(r.bombs); beep(880, 200); finish(true, '提现成功 ' + r.multiplier.toFixed(2) + '×，赢得 ' + fmt(r.payout), r.multiplier);
      }).catch(function (e) { toast(errText(e), 'err'); }).then(function () { busy = false; });
    }
  });
  mg.addEventListener('click', function (e) {
    var c = e.target.closest('.cell'); if (!c || !round || busy || c.classList.contains('safe')) return;
    busy = true; var idx = +c.getAttribute('data-i');
    api.inhouse('mines', 'reveal', { roundId: round.id, idx: idx }).then(function (r) {
      if (r.hit) { c.classList.add('bomb'); c.querySelector('.b').innerHTML = BOMB; reveal(r.bombs, idx); beep(140, 300, 0.06); finish(false, '踩到地雷，本局输掉 ' + fmt(bet), 0); return; }
      c.classList.add('safe'); c.querySelector('.b').innerHTML = GEM; beep(660 + (r.opened || 0) * 30, 90);
      if (r.cleared) { reveal(r.bombs); beep(880, 300); return finish(true, '全部清空！' + r.multiplier.toFixed(2) + '×，赢得 ' + fmt(r.payout), r.multiplier); }
      round.next = r.next; setCash(r.multiplier, r.opened);
    }).catch(function (er) { toast(errText(er), 'err'); }).then(function () { busy = false; });
  });
});
