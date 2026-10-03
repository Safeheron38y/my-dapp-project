/* 体育页：赛事+赔率列表、投注单(单关/串关)、赔率变动保护、Idempotency-Key 提交、我的注单(含开发用结算)。 */
import { api, state, fmt, errText, uuid } from './api.js';
import { mountShell, sheet, icon, esc, $, $$, toast } from './ui.js';

var SPORTS = [['', '全部'], ['football', '足球'], ['basketball', '篮球'], ['esports', '电竞'], ['tennis', '网球']];
var S = { sport: new URLSearchParams(location.search).get('sport') || '', events: [], slip: [], type: 'single', stake: '10', prev: {}, key: null, sheet: null };
var list = $('#list'), tabs = $('#sp-tabs');

tabs.innerHTML = SPORTS.map(function (s) { return '<button type="button" role="tab" data-s="' + s[0] + '" aria-selected="' + (s[0] === S.sport) + '">' + s[1] + '</button>'; }).join('');
tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; S.sport = b.getAttribute('data-s'); $$('button', tabs).forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); }); load(); });

function time(e) { if (e.live) return '<span class="tag live">滚球</span>'; var d = new Date(e.startsAt); return '<span>' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + '</span>'; }
function selected(eid, oid) { return S.slip.some(function (s) { return s.eventId === eid && s.outcomeId === oid; }); }
function evHtml(e) {
  var m = e.markets[0], n = m.outcomes.length;
  var odds = m.outcomes.map(function (o) {
    var pv = S.prev[e.id + o.id], dir = pv && o.odds > pv ? ' up' : pv && o.odds < pv ? ' dn' : '';
    return '<button class="odd' + dir + '" type="button" data-e="' + e.id + '" data-o="' + o.id + '" aria-pressed="' + selected(e.id, o.id) + '" aria-label="' + esc(o.name) + ' 赔率 ' + o.odds.toFixed(2) + '"><small>' + esc(o.id === 'd' ? '平' : o.id === 'h' ? '主胜' : '客胜') + '</small><b>' + o.odds.toFixed(2) + '</b></button>';
  }).join('');
  return '<article class="ev" data-id="' + e.id + '"><div class="lh"><span>' + esc(e.sportLabel) + ' · ' + esc(e.league) + '</span>' + time(e) + '</div>' +
    '<div class="tm"><span class="t">' + esc(e.home) + '</span><span class="vs">' + (e.score ? e.score[0] + ' : ' + e.score[1] : 'VS') + '</span><span class="t">' + esc(e.away) + '</span></div>' +
    '<div class="odds" style="--n:' + n + '">' + odds + '</div><div style="margin-top:8px"><span class="demo-tag">示例赔率</span></div></article>';
}
function render() {
  list.setAttribute('aria-busy', 'false');
  list.innerHTML = S.events.length ? S.events.map(evHtml).join('') : '<div class="empty"><b>暂无赛事</b>请切换项目查看</div>';
}
function load(silent) {
  return api.sportsEvents(S.sport).then(function (r) {
    // 记录赔率变化方向
    S.events.forEach(function (e) { e.markets[0].outcomes.forEach(function (o) { S.prev[e.id + o.id] = o.odds; }); });
    S.events = r.events;
    // 同步投注单里的最新赔率(并标记变动)
    S.slip.forEach(function (s) { var ev = r.events.filter(function (x) { return x.id === s.eventId; })[0]; if (!ev) return; var o = ev.markets[0].outcomes.filter(function (x) { return x.id === s.outcomeId; })[0]; if (o && o.odds !== s.odds) { s.newOdds = o.odds; } });
    render(); drawSlip();
  }).catch(function (e) { list.setAttribute('aria-busy', 'false'); list.innerHTML = '<div class="empty"><b>' + (e.code === 'CATEGORY_DISABLED' ? '您所在地区暂未开放体育' : '加载失败') + '</b>' + esc(errText(e)) + '<br><br><button class="btn btn-foil" id="rt" type="button">重试</button></div>'; var b = $('#rt'); if (b) b.onclick = load; });
}
list.addEventListener('click', function (e) {
  var b = e.target.closest('.odd'); if (!b) return;
  var eid = b.getAttribute('data-e'), oid = b.getAttribute('data-o');
  var ev = S.events.filter(function (x) { return x.id === eid; })[0], o = ev.markets[0].outcomes.filter(function (x) { return x.id === oid; })[0];
  var idx = -1; S.slip.forEach(function (s, i) { if (s.eventId === eid) idx = i; });
  if (idx >= 0 && S.slip[idx].outcomeId === oid) S.slip.splice(idx, 1);
  else { var it = { eventId: eid, marketId: ev.markets[0].id, outcomeId: oid, odds: o.odds, desc: ev.home + ' vs ' + ev.away, pick: o.name }; if (idx >= 0) S.slip[idx] = it; else S.slip.push(it); }
  if (S.slip.length > 1) S.type = S.type === 'single' && S.slip.length === 2 && false ? 'single' : S.type;
  S.key = null; render(); drawSlip();
});
function totals() {
  var odds = S.type === 'parlay' ? S.slip.reduce(function (a, s) { return a * (s.newOdds || s.odds); }, 1) : (S.slip[0] ? (S.slip[0].newOdds || S.slip[0].odds) : 0);
  var st = parseFloat(S.stake) || 0;
  var stakeTotal = S.type === 'single' ? st * S.slip.length : st;
  var pay = S.type === 'single' ? S.slip.reduce(function (a, s) { return a + st * (s.newOdds || s.odds); }, 0) : st * odds;
  return { odds: Math.round(odds * 100) / 100, stake: stakeTotal, pay: pay };
}
function slipHtml() {
  if (!S.slip.length) return '<h3 style="font-size:18px;margin-bottom:8px">投注单</h3><div class="empty" style="padding:24px 0"><b>投注单为空</b>点击赔率添加投注项</div>';
  var ch = S.slip.some(function (s) { return s.newOdds; });
  var items = S.slip.map(function (s, i) { return '<div class="it' + (s.newOdds ? ' ch' : '') + '"><span>' + esc(s.pick) + '</span><b>' + (s.newOdds ? s.odds.toFixed(2) + '→' + s.newOdds.toFixed(2) : s.odds.toFixed(2)) + '</b><small>' + esc(s.desc) + '</small><button class="rm" type="button" data-rm="' + i + '" aria-label="移除"><i>×</i></button></div>'; }).join('');
  var t = totals();
  return '<h3 style="font-size:18px;margin-bottom:10px">投注单 <span class="demo-tag">演示</span></h3><div class="slip">' + items +
    (S.slip.length > 1 ? '<div class="seg" id="stype"><button type="button" data-t="single" aria-pressed="' + (S.type === 'single') + '">单关 ×' + S.slip.length + '</button><button type="button" data-t="parlay" aria-pressed="' + (S.type === 'parlay') + '">串关</button></div>' : '') +
    '<label for="stk" style="margin:4px 0 0;font-size:13px;color:var(--rg3);font-weight:600">' + (S.type === 'single' && S.slip.length > 1 ? '每注金额' : '投注额') + '（演示币）</label>' +
    '<div class="stake"><button type="button" data-st="-">−</button><input class="field" id="stk" inputmode="decimal" value="' + esc(S.stake) + '" autocomplete="off"><button type="button" data-st="+">+</button></div>' +
    '<div class="sum"><span>' + (S.type === 'parlay' ? '总赔率' : '赔率') + '</span><b>' + (S.type === 'parlay' || S.slip.length === 1 ? t.odds.toFixed(2) : '各自') + '</b></div>' +
    '<div class="sum"><span>总投注</span><b>' + fmt(t.stake) + '</b></div><div class="sum"><span>预计返还</span><b>' + fmt(t.pay) + '</b></div>' +
    (ch ? '<p class="note" style="color:var(--peach);margin:0">赔率已变动，点击下方按钮将按最新赔率提交。</p>' : '') +
    '<button class="btn btn-foil btn-lg" id="place" type="button">' + (ch ? '接受新赔率并投注' : '确认投注') + '</button></div><p class="note">示例赔率与演示币，不涉及真实资金。</p>';
}
function drawSlip() {
  var n = S.slip.length, bar = $('#slipbar'); bar.hidden = n === 0; $('#sn').textContent = n;
  var side = $('#sideSlip'); side.innerHTML = slipHtml(); $('#so').textContent = '预计返还 ' + fmt(totals().pay);
  if (S.sheet) { var c = S.sheet.$('#sheetSlip'); if (c) c.innerHTML = slipHtml(); }
}
function bindSlip(root) {
  root.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-rm]'); if (rm) { S.slip.splice(+rm.getAttribute('data-rm'), 1); S.key = null; render(); drawSlip(); if (!S.slip.length && S.sheet) S.sheet.close(); return; }
    var t = e.target.closest('#stype button'); if (t) { S.type = t.getAttribute('data-t'); S.key = null; drawSlip(); return; }
    var st = e.target.closest('[data-st]'); if (st) { var v = parseFloat(S.stake) || 0; v = st.getAttribute('data-st') === '+' ? v + 10 : Math.max(1, v - 10); S.stake = String(v); S.key = null; drawSlip(); return; }
    if (e.target.closest('#place')) place();
  });
  root.addEventListener('input', function (e) { if (e.target.id === 'stk') { S.stake = e.target.value; S.key = null; var t = totals(); var r = root.querySelectorAll('.sum b'); if (r.length >= 3) { r[r.length - 2].textContent = fmt(t.stake); r[r.length - 1].textContent = fmt(t.pay); } $('#so').textContent = '预计返还 ' + fmt(t.pay); } });
}
bindSlip($('#sideSlip'));
$('#slipOpen').addEventListener('click', function () {
  S.sheet = sheet('<div id="sheetSlip"></div>', { noFocus: true, onClose: function () { S.sheet = null; } });
  S.sheet.$('#sheetSlip').innerHTML = slipHtml(); bindSlip(S.sheet.el);
});
var busy = false;
function place() {
  if (!api.requireLogin()) return;
  if (busy) return; var st = (S.stake + '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(st) || +st <= 0) return toast('请输入有效金额（最多两位小数）', 'err');
  if (S.type === 'parlay' && S.slip.length < 2) return toast('串关至少选择 2 场', 'err');
  busy = true; var accept = S.slip.some(function (s) { return s.newOdds; });
  var items = S.type === 'single' ? S.slip.map(function (s) { return [s]; }) : [S.slip];
  var done = 0, fail = null;
  S.key = S.key || uuid(); var base = S.key;
  // 单关多注：每注一个独立幂等键(基于 base+序号)，网络重试不会重复扣款
  items.reduce(function (p, grp, i) {
    return p.then(function () {
      if (fail) return;
      return api.sportsBet({ type: S.type, stake: +st, acceptOddsChange: accept, selections: grp.map(function (s) { return { eventId: s.eventId, marketId: s.marketId, outcomeId: s.outcomeId, odds: s.odds }; }) }, base + '-' + i).then(function () { done++; }).catch(function (e) { fail = e; });
    });
  }, Promise.resolve()).then(function () {
    busy = false;
    if (fail) {
      if (fail.code === 'ODDS_CHANGED') { (fail.body.changed || []).forEach(function (c) { S.slip.forEach(function (s) { if (s.eventId === c.eventId && s.outcomeId === c.outcomeId) s.newOdds = c.odds; }); }); S.key = null; drawSlip(); return toast('赔率已变动，请确认后重新提交', 'err'); }
      return toast(errText(fail) + (done ? '（已成功 ' + done + ' 注）' : ''), 'err');
    }
    toast('投注成功（演示）：' + done + ' 注'); S.slip = []; S.key = null; render(); drawSlip(); if (S.sheet) S.sheet.close();
  });
}
function myBets() {
  if (!api.requireLogin()) return;
  var s = sheet('<h3>我的注单 <span class="demo-tag">演示</span></h3><div class="mybets" id="mb"><div class="empty">加载中…</div></div><p class="note">“模拟结算”仅为开发演示（MOCK_ADMIN），真实结算由体育数据/供应商推送。</p>');
  function ld() { api.sportsBets().then(function (r) {
    s.$('#mb').innerHTML = r.bets.length ? r.bets.map(function (b) { return '<div class="bt"><div class="r"><b>' + (b.type === 'parlay' ? '串关' : '单关') + ' · ' + fmt(b.stake) + ' @ ' + b.totalOdds.toFixed(2) + '</b><span>' + ({ open: '进行中', won: '已赢', lost: '已输', void: '已作废' })[b.status] + '</span></div>' +
      '<div style="color:rgba(255,255,255,.8);margin:4px 0">' + b.selections.map(function (x) { return esc(x.desc); }).join('<br>') + '</div>' +
      (b.status === 'open' ? '<div class="r"><span>预计返还 ' + fmt(b.potentialPayout) + '</span><span><button class="btn btn-ghost" data-r="won" data-id="' + b.id + '" type="button">模拟赢</button> <button class="btn btn-ghost" data-r="lost" data-id="' + b.id + '" type="button">模拟输</button></span></div>' : '<div>返还 ' + fmt(b.payout || 0) + '</div>') + '</div>'; }).join('') : '<div class="empty"><b>暂无注单</b></div>'; }); }
  ld(); s.el.addEventListener('click', function (e) { var b = e.target.closest('[data-r]'); if (!b) return; api.sportsSettle(b.getAttribute('data-id'), b.getAttribute('data-r')).then(ld).catch(function (er) { toast(errText(er), 'err'); }); });
}
mountShell('/sports.html').then(function () {
  var mb = document.createElement('button'); mb.type = 'button'; mb.className = 'chip'; mb.textContent = '我的注单'; mb.style.cssText = 'flex:0 0 auto;margin-left:auto'; mb.onclick = myBets; tabs.appendChild(mb);
  return load();
});
setInterval(function () { if (!document.hidden && !busy && !(S.sheet)) load(true); }, 8000);
