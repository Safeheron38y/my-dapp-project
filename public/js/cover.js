/* 封面组件：占位封面（程序化渐变+品类图形，无网络）；当游戏对象带图片 URL 字段时自动换成真实封面。
   供应商接入后只需让 /api/games 返回 thumb（兼容 cover / coverUrl / image / imageUrl / img），无需改前端。 */
var MOTIF = {
  slots: '<rect x="10" y="30" width="24" height="40" rx="6"/><rect x="38" y="30" width="24" height="40" rx="6"/><rect x="66" y="30" width="24" height="40" rx="6"/>',
  fishing: '<path d="M0 70q12-10 25 0t25 0 25 0 25 0M0 82q12-10 25 0t25 0 25 0 25 0"/><path d="M28 40c8-12 22-12 32 0-10 12-24 12-32 0zM60 40l12-8v16z"/>',
  live: '<circle cx="50" cy="52" r="30"/><circle cx="50" cy="52" r="18"/><path d="M14 52h72"/>',
  table: '<rect x="18" y="22" width="34" height="48" rx="6" transform="rotate(-10 35 46)"/><rect x="46" y="26" width="34" height="48" rx="6" transform="rotate(9 63 50)"/>',
  crash: '<path d="M8 82C30 80 48 66 62 40l10-16"/><path d="M60 24h14v14"/>',
  sports: '<circle cx="50" cy="50" r="32"/><path d="M50 18v64M18 50h64M26 28q24 22 0 44M74 28q-24 22 0 44"/>'
};
var URL_FIELDS = ['thumb', 'cover', 'coverUrl', 'image', 'imageUrl', 'img'];
function h(s) { var n = 0; for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) | 0; return Math.abs(n); }
/* 仅接受 http(s)://、站内绝对路径(/…)、data:image/（拒绝 javascript: 等） */
export function coverUrl(g) {
  for (var i = 0; i < URL_FIELDS.length; i++) {
    var u = g[URL_FIELDS[i]];
    if (typeof u === 'string' && /^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(u)) return u;
  }
  return '';
}
export function placeholder(g) {
  var v = g.vendor || g.providerLabel || g.provider, hv = h(v), hg = h(g.id);
  var h1 = hv % 360, h2 = (h1 + 24 + (hv >> 5) % 46) % 360, ang = 128 + (hg % 6) * 11;
  var bg = 'linear-gradient(' + ang + 'deg,hsl(' + h1 + ',56%,41%),hsl(' + h2 + ',54%,19%))';
  var m = MOTIF[g.category] || MOTIF.slots;
  var sx = (hg % 30) - 10, sy = (hg >> 4) % 18;
  var svg = '<svg class="pat" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><g transform="translate(' + sx + ' ' + (sy - 8) + ') rotate(' + ((hg % 7) - 3) + ' 50 50)" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + m + '</g></svg>';
  return { bg: bg, svg: svg };
}
/* 返回 { bg, svg, img, has }：img 为 <img> 标记(无 URL 时为空串)。esc 由调用方传入以避免循环依赖 */
export function cover(g, esc) {
  var p = placeholder(g), u = coverUrl(g);
  p.has = !!u;
  p.img = u ? '<img class="cimg" src="' + esc(u) + '" alt="" loading="lazy" decoding="async" draggable="false">' : '';
  return p;
}
/* 封面图加载失败 → 回退占位封面（事件不冒泡，需在捕获阶段监听） */
export function watchCovers(root) {
  root.addEventListener('error', function (e) {
    var t = e.target; if (!t || t.tagName !== 'IMG' || !t.classList.contains('cimg')) return;
    var tile = t.closest('.tile'); if (tile) tile.classList.remove('hasimg'); if (t.parentNode) t.parentNode.removeChild(t);
  }, true);
}
