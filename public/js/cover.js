/* 封面组件。
   1) 真封面：/api/games 返回的 thumb（HUIDU 素材包 public/covers/<game_uid>.webp；同时兼容 cover / coverUrl / image / imageUrl / img 字段）→ <img loading=lazy width height>，
      盒子由 CSS aspect-ratio 固定，图片加载前后不产生布局位移；加载失败/缺图 → 保留占位封面。
   2) 占位封面：由游戏 id 决定的渐变（每款不同）+ 品类图形 + 游戏名文字，无网络请求。 */
var MOTIF = {
  slots: '<rect x="8" y="28" width="26" height="44" rx="6"/><rect x="37" y="28" width="26" height="44" rx="6"/><rect x="66" y="28" width="26" height="44" rx="6"/><path d="M14 44h14M43 44h14M72 44h14"/>',
  fishing: '<path d="M0 70q12-10 25 0t25 0 25 0 25 0M0 82q12-10 25 0t25 0 25 0 25 0"/><path d="M26 40c8-12 24-12 34 0-10 12-26 12-34 0zM60 40l13-8v16z"/><circle cx="36" cy="38" r="2"/>',
  live: '<circle cx="50" cy="52" r="32"/><circle cx="50" cy="52" r="20"/><circle cx="50" cy="52" r="6"/><path d="M50 20v64M18 52h64"/>',
  table: '<rect x="16" y="20" width="36" height="52" rx="6" transform="rotate(-10 34 46)"/><rect x="46" y="24" width="36" height="52" rx="6" transform="rotate(9 64 50)"/><path d="M60 40l5 8-5 8-5-8z"/>',
  crash: '<path d="M6 84C30 82 50 66 64 40l10-16"/><path d="M60 24h16v16"/><path d="M6 94h88" opacity=".5"/>',
  sports: '<circle cx="50" cy="50" r="32"/><path d="M50 18v64M18 50h64M26 28q24 22 0 44M74 28q-24 22 0 44"/>'
};
var URL_FIELDS = ['thumb', 'cover', 'coverUrl', 'image', 'imageUrl', 'img'];
function h(s) { var n = 5381; for (var i = 0; i < s.length; i++) n = ((n * 33) ^ s.charCodeAt(i)) | 0; return Math.abs(n); }
/* 仅接受 http(s)://、站内绝对路径(/…)、data:image/（拒绝 javascript: 等） */
export function coverUrl(g) {
  for (var i = 0; i < URL_FIELDS.length; i++) {
    var u = g[URL_FIELDS[i]];
    if (typeof u === 'string' && /^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(u)) return u;
  }
  return '';
}
export function placeholder(g) {
  var k = String(g.id), hg = h(k), hg2 = h(k + '#'), hg3 = h('#' + k);
  // 玉漆色系：玉/青瓷/墨绿为主，偶尔朱砂或拉丝金（不出现紫色）
  var PAL = [[162, 45, 40], [158, 38, 34], [150, 30, 44], [168, 42, 30], [12, 58, 46], [38, 52, 46]];
  var c = PAL[hg % PAL.length], h1 = c[0] + (hg2 % 7) - 3, h2 = c[0] < 100 ? c[0] - 4 : 164, ang = 120 + (hg3 % 8) * 14, sat = c[1], l1 = c[2] + hg3 % 6;
  var bg = 'linear-gradient(' + ang + 'deg,hsl(' + h1 + ',' + sat + '%,' + l1 + '%),hsl(' + h2 + ',' + (sat - 6) + '%,' + Math.max(14, l1 - 22) + '%))';
  var m = MOTIF[g.category] || MOTIF.slots;
  var sx = (hg % 24) - 8, sy = (hg2 % 16) - 12, rot = (hg3 % 15) - 7, sc = 1 + (hg % 5) / 20;
  var dots = '';
  for (var i = 0; i < 4; i++) dots += '<circle cx="' + (8 + (h(k + i) % 84)) + '" cy="' + (8 + (h(k + 'y' + i) % 50)) + '" r="' + (1 + (h(k + 'r' + i) % 3)) + '" fill="rgba(255,255,255,.28)" stroke="none"/>';
  var svg = '<svg class="pat" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><g fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(' + sx + ' ' + sy + ') rotate(' + rot + ' 50 50) translate(50 50) scale(' + sc + ') translate(-50 -50)">' + m + '</g>' + dots + '</g></svg>';
  var n = String(g.name || '').length;
  return { bg: bg, svg: svg, sz: n <= 9 ? 1 : n <= 18 ? 2 : 3 };
}
/* 返回 { bg, svg, sz, img, has }：img 为 <img> 标记(无 URL 时为空串)。esc 由调用方传入以避免循环依赖 */
export function cover(g, esc) {
  var p = placeholder(g), u = coverUrl(g);
  p.has = !!u;
  var w = +g.thumbW || 300, hh = +g.thumbH || 300;
  p.img = u ? '<img class="cimg" src="' + esc(u) + '" alt="" width="' + w + '" height="' + hh + '" loading="lazy" decoding="async" draggable="false">' : '';
  return p;
}
/* 封面图加载成功 → 隐藏占位；失败 → 回退占位封面（load/error 不冒泡，需在捕获阶段监听） */
export function watchCovers(root) {
  root.addEventListener('load', function (e) {
    var t = e.target; if (!t || t.tagName !== 'IMG' || !t.classList.contains('cimg')) return;
    var tile = t.closest('.tile'); if (tile) tile.classList.add('ok');
  }, true);
  root.addEventListener('error', function (e) {
    var t = e.target; if (!t || t.tagName !== 'IMG' || !t.classList.contains('cimg')) return;
    var tile = t.closest('.tile'); if (tile) tile.classList.remove('hasimg'); if (t.parentNode) t.parentNode.removeChild(t);
  }, true);
}
