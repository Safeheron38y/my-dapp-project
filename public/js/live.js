/**
 * 真人视讯窗口外壳：视频流占位 + 投注面板 + 筹码托盘 + 路单(百家乐)占位。
 * 真实接入：把 #vid 区域换成供应商的视频流 iframe/WebRTC，投注通过供应商自己的协议或本站共享钱包回调；
 * 这里的“确认下注”调用 POST /api/live/:game/bet，由服务器 mock RNG 立即开牌(演示)。
 */
import { api, fmt, errText, uuid } from './api.js';
import { GameWindow } from './gamewindow.js';
import { icon, esc, $, $$, toast } from './ui.js';

var qs = new URLSearchParams(location.search), game = qs.get('game') || 'baccarat', gid = qs.get('id') || '';
var CFG = {
  baccarat: { name: '百家乐', cols: 3, spots: [['player', '闲', '1:1', 'p'], ['tie', '和', '1:8', 't'], ['banker', '庄', '1:0.95', 'b'], ['pplayer', '闲对', '1:11', 'p'], ['pbanker', '庄对', '1:11', 'b']] },
  dragontiger: { name: '龙虎', cols: 3, spots: [['dragon', '龙', '1:1', 'p'], ['tie', '和', '1:8', 't'], ['tiger', '虎', '1:1', 'b']] },
  roulette: { name: '轮盘', cols: 3, spots: [['red', '红', '1:1', 'b'], ['black', '黑', '1:1', ''], ['odd', '单', '1:1', ''], ['even', '双', '1:1', ''], ['low', '小 1-18', '1:1', ''], ['high', '大 19-36', '1:1', ''], ['dozen1', '第一打', '1:2', ''], ['dozen2', '第二打', '1:2', ''], ['dozen3', '第三打', '1:2', '']] },
  blackjack: { name: '二十一点', cols: 1, spots: [['main', '本局下注', '1:1', 'p']] },
};
var cfg = CFG[game] || CFG.baccarat;
var CHIPS = [[1, '#5B3CC4'], [5, '#C2478A'], [10, '#2f8f6f'], [50, '#b97a1e'], [100, '#2B1B5E'], [500, '#8a2a52']];
var RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
var CARD = function (n) { return ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][n] || n; };

var gw = new GameWindow({ title: cfg.name + '（演示厅）', orientation: 'any', provider: '视频流占位' });
gw.opt.onReconnect = start;

var bets = {}, chip = 10, busy = false, phase = 'bet', tleft = 0, timer = 0, road = [], last = {}, lastBets = null, roundNo = 1000;
function total() { var t = 0; for (var k in bets) t += bets[k]; return Math.round(t * 100) / 100; }

function build() {
  var spots = cfg.spots.map(function (s) { return '<button class="spot ' + s[3] + '" type="button" data-s="' + s[0] + '" aria-label="' + s[1] + ' 赔率 ' + s[2] + '"><span>' + s[1] + '</span><small>' + s[2] + '</small><span class="amt" hidden></span></button>'; }).join('');
  var nums = '';
  if (game === 'roulette') { nums = '<div><h4 style="font-size:12px;letter-spacing:.12em;color:var(--rg3);margin-bottom:6px">直注（1:35）</h4><div class="numgrid" id="nums">' + Array.apply(null, Array(37)).map(function (_, i) { return '<button type="button" data-s="n' + i + '" class="' + (i === 0 ? 'g' : RED.indexOf(i) >= 0 ? 'r' : 'k') + '" aria-label="数字 ' + i + '">' + i + '</button>'; }).join('') + '</div></div>'; }
  gw.slot.innerHTML = '<div class="lv"><div class="lv-left"><div class="vid" id="vid"><div class="table-ar"></div>' +
    '<svg class="dealer" viewBox="0 0 120 150" aria-hidden="true"><defs><linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7D3C4"/><stop offset="1" stop-color="#C2478A"/></linearGradient></defs><circle cx="60" cy="40" r="24" fill="url(#dg)" opacity=".7"/><path d="M12 150c2-42 22-62 48-62s46 20 48 62z" fill="url(#dg)" opacity=".5"/></svg>' +
    '<div class="pulse-ring" aria-hidden="true"></div>' +
    '<div class="ph"><span class="tag live">LIVE · 演示</span><span class="phase" id="phase"><span id="phT">下注中</span><b id="cd">--</b></span></div>' +
    '<div class="center"><b>视频流占位</b>真实环境在此嵌入供应商视频流</div>' +
    '<div class="resv" id="resv" hidden></div></div>' +
    '<div class="lv-main" style="padding-bottom:0">' + (game === 'baccarat' ? '<div class="road"><h4><span>路单（示例，随机演示）</span><span class="demo-tag">演示</span></h4><div class="rg" id="road"></div><div class="lg"><span><i style="background:#6a8bff"></i>闲</span><span><i style="background:#ff6f91"></i>庄</span><span><i style="background:#5fd49a"></i>和</span><span id="rdn"></span></div></div>' : '') + '</div></div>' +
    '<div class="lv-main"><div class="spots" id="spots" style="--cols:' + cfg.cols + '">' + spots + '</div>' + nums +
    '<div class="tray" id="tray" role="group" aria-label="筹码">' + CHIPS.map(function (c) { return '<button class="chipb" type="button" data-c="' + c[0] + '" style="--cc:' + c[1] + '" aria-pressed="' + (c[0] === chip) + '" aria-label="筹码 ' + c[0] + '">' + c[0] + '</button>'; }).join('') + '</div>' +
    '<div class="lv-act"><button class="btn btn-ghost" id="clr" type="button">清除</button><button class="btn btn-ghost" id="rep" type="button">重复</button><button class="btn btn-foil" id="ok" type="button">确认下注 <span id="tot">0</span></button></div>' +
    '<div class="res" id="res" style="text-align:center;font-size:14px;font-weight:600;color:var(--rg3);min-height:22px" aria-live="polite">选择筹码，点击下注区</div>' +
    '<p style="font-size:11px;color:rgba(255,255,255,.7);line-height:1.6">演示用途：没有真实视频与荷官，开牌由服务器 mock RNG 即时生成。真实视讯由供应商决定结果并通过共享钱包回调结算。</p></div></div>';
  if (game === 'baccarat') { for (var i = 0; i < 24; i++) road.push(['P', 'B', 'T'][Math.random() < .1 ? 2 : Math.random() < .5 ? 0 : 1]); drawRoad(); }
  gw.slot.addEventListener('click', onClick);
  $('#res', gw.slot).textContent = '选择筹码，点击下注区';
  cycle();
}
function drawRoad() {
  var el = $('#road'); if (!el) return; var cols = [], cur = [];
  road.forEach(function (r, i) { if (cur.length && (cur[0] !== r || cur.length >= 6)) { cols.push(cur); cur = []; } cur.push(r); }); if (cur.length) cols.push(cur);
  cols = cols.slice(-18); var h = '';
  cols.forEach(function (c) { for (var i = 0; i < 6; i++) h += c[i] ? '<i class="' + c[i] + '"></i>' : '<i class="ph"></i>'; });
  el.innerHTML = h; el.scrollLeft = 9999; var n = $('#rdn'); if (n) n.textContent = '近 ' + road.length + ' 局';
}
function refresh() {
  $$('.spot,.numgrid button', gw.slot).forEach(function (b) {
    var s = b.getAttribute('data-s'), a = bets[s], t = $('.amt', b);
    if (!t) { t = document.createElement('span'); t.className = 'amt'; b.appendChild(t); }
    t.hidden = !a; t.textContent = a || '';
  });
  $('#tot', gw.slot).textContent = fmt(total());
  var can = phase === 'bet' && !busy && total() > 0; $('#ok', gw.slot).disabled = !can; $('#ok', gw.slot).classList.toggle('dis', !can);
}
function onClick(e) {
  var t = e.target.closest('[data-c]'); if (t) { chip = +t.getAttribute('data-c'); $$('.chipb', gw.slot).forEach(function (b) { b.setAttribute('aria-pressed', b === t ? 'true' : 'false'); }); return; }
  var s = e.target.closest('[data-s]'); if (s) { if (phase !== 'bet' || busy) return; var k = s.getAttribute('data-s'); bets[k] = Math.round(((bets[k] || 0) + chip) * 100) / 100; refresh(); return; }
  if (e.target.closest('#clr')) { bets = {}; refresh(); }
  else if (e.target.closest('#rep')) { if (lastBets && phase === 'bet') { bets = JSON.parse(JSON.stringify(lastBets)); refresh(); } }
  else if (e.target.closest('#ok')) place();
}
var plKey = null;
function place() {
  if (phase !== 'bet' || busy || total() <= 0) return;
  busy = true; refresh();
  var arr = Object.keys(bets).map(function (k) { return { spot: k, amount: bets[k] }; });
  plKey = plKey || uuid(); // 网络失败后重试沿用同一幂等键，避免重复扣款
  api.liveBet(game, gid, arr, plKey).then(function (r) {
    plKey = null; lastBets = JSON.parse(JSON.stringify(bets)); bets = {}; phase = 'result'; busy = false;
    showResult(r);
  }).catch(function (er) {
    busy = false; refresh(); if (er.code !== 'NETWORK') plKey = null; toast(errText(er) + (er.code === 'NETWORK' ? '（可再次点击确认，不会重复扣款）' : ''), 'err');
  });
}
function cardsHtml(a) { return a.map(function (c) { return '<em>' + CARD(c) + '</em>'; }).join(''); }
function showResult(r) {
  var x = r.result, v = $('#resv', gw.slot), msg = '', row = '';
  if (game === 'baccarat') { row = '<div class="cards-r">闲 ' + cardsHtml(x.cards.player) + ' &nbsp; 庄 ' + cardsHtml(x.cards.banker) + '</div>'; msg = x.points.player + ' : ' + x.points.banker + ' · ' + ({ player: '闲赢', banker: '庄赢', tie: '和局' })[x.win]; road.push({ player: 'P', banker: 'B', tie: 'T' }[x.win]); drawRoad(); }
  else if (game === 'dragontiger') { row = '<div class="cards-r">龙 ' + cardsHtml(x.cards.dragon) + ' &nbsp; 虎 ' + cardsHtml(x.cards.tiger) + '</div>'; msg = ({ dragon: '龙赢', tiger: '虎赢', tie: '和局' })[x.win]; }
  else if (game === 'roulette') { msg = '开出 ' + x.number + '（' + ({ red: '红', black: '黑', green: '绿' })[x.color] + '）'; }
  else { row = '<div class="cards-r">闲 ' + cardsHtml(x.cards.player) + ' &nbsp; 庄 ' + cardsHtml(x.cards.dealer) + '</div>'; msg = x.points.player + ' 对 ' + x.points.dealer; }
  v.hidden = false; v.innerHTML = row + msg;
  var net = r.payout - r.stake;
  var res = $('#res', gw.slot); res.textContent = (net > 0 ? '赢 ' + fmt(net) : net === 0 ? '平 ' : '输 ' + fmt(-net)) + '（派彩 ' + fmt(r.payout) + '）'; res.style.color = net > 0 ? '#b7f0c8' : net < 0 ? '#ffb4a0' : '';
  refresh(); setPhase('result', 4);
}
function setPhase(p, sec) {
  clearInterval(timer); phase = p; tleft = sec; var name = { bet: '下注中', result: '开牌结果', wait: '等待下一局' };
  function paint() { $('#phT', gw.slot).textContent = name[phase]; $('#cd', gw.slot).textContent = tleft; refresh(); }
  paint();
  timer = setInterval(function () {
    if (document.hidden) return; tleft--;
    if (tleft <= 0) { clearInterval(timer); if (phase === 'result') { $('#resv', gw.slot).hidden = true; roundNo++; cycle(); } else if (phase === 'bet') { bets = {}; setPhase('wait', 3); toast('本局下注已截止'); } else cycle(); } else paint();
  }, 1000);
}
function cycle() { $('#res', gw.slot).style.color = ''; $('#res', gw.slot).textContent = '第 ' + roundNo + ' 局 · 请下注'; setPhase('bet', 25); }

function start() {
  gw.showLoading('正在进入演示厅…');
  api.ensure().then(function () { return api.launch(gid || ('live-' + game + '-a')); })
    .then(function () { gw.hideState(); build(); })
    .catch(function (e) { gw.showError(errText(e)); });
}
start();
