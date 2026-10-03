import { api, state, errText } from './api.js';
import { mountShell, icon, cicon, esc, $, $$, toast, sheet as sheetUI } from './ui.js';
import { cover, watchCovers } from './cover.js';
import { initBanners } from './banners.js';

/* 大厅：一次拉取全部游戏(<=1000)，在客户端做 分类/厂商/子类/标签/搜索 过滤——切换零延迟；
   渲染采用“分批 + IntersectionObserver 触底加载 + content-visibility:auto”惰性渲染，170+ 款在手机上也只渲染可视附近的瓦片。 */
var CAT_ICON = { live: 'live', slots: 'slots', table: 'table', crash: 'crash', sports: 'sports', fishing: 'fish' };
var SUB = { baccarat: '百家乐', blackjack: '二十一点', roulette: '轮盘', dragontiger: '龙虎', video: '视频老虎机', poker: '扑克', dice: '骰子', crash: '飞行/Crash', fishing: '捕鱼', sicbo: '骰宝', niuniu: '牛牛', landlord: '斗地主', goldenflower: '炸金花', holdem: '德州扑克', rummy: 'Rummy', instant: '即时', arcade: '街机', gameshow: '游戏秀', lobby: '游戏大厅', thirteen: '十三水', runfast: '跑得快', guandan: '掼蛋', sportsbook: '体育' };
var BATCH = 24;
var S = { cat: '', q: '', vendor: '', tag: '', sub: '' };
var D = { all: [], cats: [], vendors: [], logos: {}, aliases: {}, view: [], shown: 0, seq: 0 };
var grid = $('#grid'), tabs = $('#tabs'), chips = $('#chips'), vendorBtn = $('#vendorBtn'), moreBtn = $('#more'), qIn = $('#q'), qClear = $('#qc');

function href(g) { return '/game.html?id=' + encodeURIComponent(g.id); }

function logoImg(v, cls) { var u = D.logos[v]; return u ? '<img src="' + esc(u) + '" alt="" width="40" height="20" loading="lazy" decoding="async" draggable="false">' : ''; }
function tile(g, i) {
  var c = cover(g, esc);
  var tags = (g.tags.indexOf('hot') >= 0 ? '<span class="bdg hot">' + cicon('hot') + '热门</span>' : '') + (g.tags.indexOf('new') >= 0 ? '<span class="bdg new">' + cicon('new') + '新品</span>' : '');
  return '<a class="tile' + (g.playable ? '' : ' dis') + (c.has ? ' hasimg' : '') + '" style="--tg:' + c.bg + '" href="' + href(g) + '" data-id="' + esc(g.id) + '" aria-label="' + esc(g.name) + '，' + esc(g.vendor) + '">' +
    '<span class="cv" aria-hidden="true"><span class="art"></span>' + c.svg + '<span class="pn s' + c.sz + '">' + esc(g.name) + '</span>' + c.img +
    '<span class="ic">' + cicon(CAT_ICON[g.category] || 'all') + '</span><span class="tags">' + tags + '</span></span>' +
    '<span class="info"><b>' + esc(g.name) + '</b><small>' + (D.logos[g.vendor] ? '<span class="vlg">' + logoImg(g.vendor) + '</span>' : '') + '<span class="vt">' + esc(g.vendor) + ' · ' + esc(SUB[g.subcategory] || g.subcategory) + '</span></small></span></a>';
}

var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '120px' }) : null;
var sio = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { if (es[0].isIntersecting && D.shown < D.view.length) renderMore(); }, { rootMargin: '700px' }) : null;
var sentinel = $('#sentinel');
if (sio) sio.observe(sentinel);

function renderMore() {
  var end = Math.min(D.shown + BATCH, D.view.length), html = '';
  for (var i = D.shown; i < end; i++) html += tile(D.view[i], i);
  var tmp = document.createElement('div'); tmp.innerHTML = html;
  var frag = document.createDocumentFragment(), nodes = Array.prototype.slice.call(tmp.children);
  nodes.forEach(function (n) { frag.appendChild(n); if (io) io.observe(n); else n.classList.add('in'); });
  grid.appendChild(frag);
  D.shown = end;
  moreBtn.hidden = !!sio || D.shown >= D.view.length;
  // IntersectionObserver 只在“相交状态变化”时回调：若补满一批后哨兵仍在预加载范围内(大屏/WebKit 的 content-visibility 估高)，需重新观察以触发下一批
  if (sio && D.shown < D.view.length) requestAnimationFrame(function () { sio.unobserve(sentinel); sio.observe(sentinel); });
}
function skeleton() {
  var s = '<div class="ldr" role="status"><span class="ld" aria-hidden="true"><img class="r" src="/assets/loader-ring.svg" alt="" width="64" height="64"><img class="m" src="/assets/logo-mark.svg" alt="" width="34" height="34"></span><b>加载中…</b></div>';
  for (var i = 0; i < 6; i++) s += '<div class="skel" aria-hidden="true"></div>';
  grid.innerHTML = s; grid.setAttribute('aria-busy', 'true');
}

/* ---- 过滤 ---- */
function catLabel(id) { var c = D.cats.filter(function (x) { return x.id === id; })[0]; return c ? c.label : ''; }
function hay(g) { return g._h || (g._h = [g.name, g.id, g.vendor, g.subcategory, SUB[g.subcategory] || '', catLabel(g.category)].join(' ').toLowerCase()); }
function terms(q) {
  var t = q.trim().toLowerCase(); if (!t) return [];
  var out = [t]; Object.keys(D.aliases).forEach(function (k) { if (t.indexOf(k) >= 0) out.push(D.aliases[k]); });
  return out;
}
function pass(g, skip) {
  if (skip !== 'cat' && S.cat && g.category !== S.cat) return false;
  if (skip !== 'vendor' && S.vendor && g.vendor !== S.vendor) return false;
  if (skip !== 'sub' && S.sub && g.subcategory !== S.sub) return false;
  if (skip !== 'tag' && S.tag && g.tags.indexOf(S.tag) < 0) return false;
  if (skip !== 'q' && S.q) { var hs = hay(g); if (!terms(S.q).some(function (t) { return hs.indexOf(t) >= 0; })) return false; }
  return true;
}
function apply() {
  D.view = D.all.filter(function (g) { return pass(g); });
  grid.innerHTML = ''; D.shown = 0; grid.setAttribute('aria-busy', 'false');
  $('#secT').textContent = S.cat ? catLabel(S.cat) : '全部游戏';
  $('#secC').textContent = D.view.length + ' 款';
  drawTabs(); drawVendors(); drawChips();
  if (!D.view.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><img src="/assets/empty-search.svg" alt="" width="160" height="120"><b>没有找到相关游戏</b>换个关键词，或调整筛选条件试试</div>'; moreBtn.hidden = true; return; }
  renderMore();
}

function drawTabs() {
  var counts = {}; D.all.forEach(function (g) { if (pass(g, 'cat')) counts[g.category] = (counts[g.category] || 0) + 1; });
  var total = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0);
  var all = [{ id: '', label: '全部', enabled: true, n: total }].concat(D.cats.map(function (c) { return Object.assign({ n: counts[c.id] || 0 }, c); }));
  if (tabs.children.length !== all.length) { // 仅首次构建；之后只更新计数/选中态，保留横向滚动位置
    tabs.innerHTML = all.map(function (c) { return '<button type="button" role="tab" data-c="' + c.id + '"' + (c.enabled ? '' : ' class="off" title="暂未开放"') + '>' + cicon(CAT_ICON[c.id] || 'all') + '<span class="tl">' + esc(c.label) + '</span><span class="n"></span></button>'; }).join('');
  }
  all.forEach(function (c, i) {
    var b = tabs.children[i], sel = c.id === S.cat;
    b.setAttribute('aria-selected', sel); b.querySelector('.n').textContent = c.n;
  });
}
function centerTab() { // 选中的分类滚到可视区中间（只滚动横条自身，不动页面）
  var b = tabs.querySelector('[aria-selected=true]'); if (!b) return;
  var left = b.offsetLeft - (tabs.clientWidth - b.offsetWidth) / 2;
  if (tabs.scrollTo) { try { tabs.scrollTo({ left: left, behavior: 'smooth' }); return; } catch (e) {} }
  tabs.scrollLeft = left;
}
function vendorCounts() { var m = {}; D.all.forEach(function (g) { if (pass(g, 'vendor')) m[g.vendor] = (m[g.vendor] || 0) + 1; }); return m; }
function drawVendors() {
  var m = vendorCounts();
  if (S.vendor && !m[S.vendor]) S.vendor = '';
  $('#vendorTxt').textContent = S.vendor || '全部厂商';
  vendorBtn.classList.toggle('on', !!S.vendor);
  vendorBtn.setAttribute('aria-label', '厂商筛选：' + (S.vendor || '全部厂商') + '，点击选择');
}
function openVendors() {
  var m = vendorCounts(), total = Object.keys(m).reduce(function (a, k) { return a + m[k]; }, 0);
  var names = D.vendors.map(function (v) { return v.id; }).sort(function (a, b) { a = a.toLowerCase(); b = b.toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; });
  var row = function (v, label, n) {
    var sel = v === S.vendor, dis = !n && v;
    return '<button type="button" class="vrow" role="option" data-v="' + esc(v) + '" aria-selected="' + sel + '"' + (dis ? ' aria-disabled="true" disabled' : '') + '>' + (v ? '<span class="vl' + (D.logos[v] ? '' : ' none') + '">' + logoImg(v) + '</span>' : '<span class="vl none">' + cicon('all') + '</span>') + '<span class="vn">' + esc(label) + '</span><em>' + n + '</em><svg class="ck" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
  };
  var html = '<h3>选择厂商</h3><p class="sub">共 ' + names.length + ' 家 · 按字母排序 · 数字为当前筛选下的游戏数</p><div class="vlist" role="listbox" aria-label="厂商">' + row('', '全部厂商', total) + names.map(function (v) { return row(v, v, m[v] || 0); }).join('') + '</div>';
  var sh = sheetUI(html, { noFocus: true });
  var cur = sh.el.querySelector('.vrow[aria-selected=true]'); if (cur && cur.scrollIntoView) setTimeout(function () { try { cur.scrollIntoView({ block: 'center' }); } catch (e) {} }, 320);
  sh.el.addEventListener('click', function (e) {
    var b = e.target.closest('.vrow'); if (!b || b.disabled) return;
    S.vendor = b.getAttribute('data-v'); apply(); sh.close();
  });
}
function drawChips() {
  var hasTag = function (t) { return D.all.some(function (g) { return pass(g, 'tag') && g.tags.indexOf(t) >= 0; }); };
  var out = [['t', '', '全部']];
  if (hasTag('hot')) out.push(['t', 'hot', '热门']);
  if (hasTag('new')) out.push(['t', 'new', '新品']);
  if (!S.cat || S.cat === 'slots' || S.cat === 'table') out.push(['k', '麻将', '麻将']);
  var subs = {}; D.all.forEach(function (g) { if (pass(g, 'sub')) subs[g.subcategory] = (subs[g.subcategory] || 0) + 1; });
  var keys = Object.keys(subs);
  if (S.cat && keys.length > 1) keys.sort(function (a, b) { return subs[b] - subs[a]; }).forEach(function (k) { out.push(['s', k, (SUB[k] || k) + ' ' + subs[k]]); });
  chips.hidden = out.length < 2;
  chips.innerHTML = out.map(function (c) {
    var pressed = c[0] === 't' ? (S.tag === c[1] && !S.sub && !(c[1] === '' && S.q === '麻将')) : c[0] === 's' ? S.sub === c[1] : S.q === c[1];
    return '<button class="chip" type="button" data-' + c[0] + '="' + esc(c[1]) + '" aria-pressed="' + pressed + '">' + (c[0] === 't' && (c[1] === 'hot' || c[1] === 'new') ? cicon(c[1]) : '') + esc(c[2]) + '</button>';
  }).join('');
}

tabs.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-c]'); if (!b) return;
  if (b.classList.contains('off')) return toast('该品类暂未开放', 'err');
  S.cat = b.getAttribute('data-c'); S.vendor = ''; S.sub = ''; S.tag = '';
  history.replaceState(null, '', S.cat ? '#' + S.cat : location.pathname); apply(); centerTab();
  window.scrollTo(0, Math.min(window.scrollY, $('#ctl').offsetTop));
});
chips.addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-s')) { S.sub = S.sub === b.getAttribute('data-s') ? '' : b.getAttribute('data-s'); S.tag = ''; }
  else if (b.hasAttribute('data-k')) { var k = b.getAttribute('data-k'); S.q = S.q === k ? '' : k; qIn.value = S.q; S.sub = ''; }
  else { S.tag = b.getAttribute('data-t'); S.sub = ''; if (!S.tag) { S.q = ''; qIn.value = ''; } }
  apply();
});
vendorBtn.addEventListener('click', openVendors);
var qT; qIn.addEventListener('input', function (e) { qClear.hidden = !e.target.value; clearTimeout(qT); qT = setTimeout(function () { S.q = e.target.value.trim(); apply(); }, 160); });
qClear.addEventListener('click', function () { qIn.value = ''; qClear.hidden = true; S.q = ''; apply(); qIn.focus(); });
$('#qf').addEventListener('submit', function (e) { e.preventDefault(); qIn.blur(); });
moreBtn.addEventListener('click', renderMore);

function load() {
  var seq = ++D.seq; skeleton();
  return api.games({ limit: 1000 }).then(function (r) {
    if (seq !== D.seq) return;
    D.cats = r.categories; D.aliases = r.aliases || {}; D.vendors = r.vendors || []; D.logos = {}; D.vendors.forEach(function (v) { if (v.logo) D.logos[v.id] = v.logo; });
    D.all = r.games; // 服务器已按“混排”顺序返回（跨品类、跨厂商穿插；后台可调排序）
    var hsh = location.hash.replace('#', ''); if (D.cats.some(function (c) { return c.id === hsh; })) S.cat = hsh;
    var q = new URLSearchParams(location.search); if (q.get('cat')) S.cat = q.get('cat');
    apply(); centerTab();
  }).catch(function (e) {
    if (seq !== D.seq) return;
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><img src="/assets/empty-error.svg" alt="" width="160" height="120"><b>加载失败</b>' + esc(errText(e)) + '<br><br><button class="btn btn-foil btn-royal" id="rt" type="button">重试</button></div>';
    var b = $('#rt'); if (b) b.onclick = load;
  });
}
window.addEventListener('hashchange', function () { var hsh = location.hash.replace('#', ''); if (hsh === '' || D.cats.some(function (c) { return c.id === hsh; })) { S.cat = hsh; S.vendor = ''; S.sub = ''; S.tag = ''; apply(); centerTab(); } });
watchCovers(grid);
initBanners($('#bn'), function (go) {
  var el = $('#ctl'), top = el ? el.getBoundingClientRect().top + window.scrollY - (window.innerWidth >= 900 ? 68 : 60) : 0;
  S.cat = D.cats.some(function (c) { return c.id === go; }) ? go : ''; S.vendor = ''; S.sub = ''; S.tag = go === 'hot' || go === 'new' ? go : '';
  history.replaceState(null, '', S.cat ? '#' + S.cat : location.pathname); if (D.all.length) { apply(); centerTab(); }
  window.scrollTo(0, Math.max(0, top));
});
mountShell('/').then(load);
