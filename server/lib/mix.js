'use strict';
// 默认“混排”顺序：同品类内按厂商轮流（不会连着一排同一厂商），再按各品类占比把品类穿插（不会先是一大片老虎机）。后台“排序”字段优先。
function mixOrder(list) {
  const vOf = (g) => g.vendor || g.provider;
  const byCat = new Map();
  for (const g of list) { if (!byCat.has(g.category)) byCat.set(g.category, []); byCat.get(g.category).push(g); }
  const keyed = [];
  let ci = 0;
  for (const [, arr] of byCat) {
    const byV = new Map();
    for (const g of arr) { const v = vOf(g); if (!byV.has(v)) byV.set(v, []); byV.get(v).push(g); }
    const lists = [...byV.values()].sort((a, b) => b.length - a.length), rr = [];
    for (let r = 0; rr.length < arr.length; r++) for (const l of lists) if (r < l.length) rr.push(l[r]);
    rr.forEach((g, i) => keyed.push([(i + 0.5) / rr.length, ci, g]));
    ci++;
  }
  return keyed.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}
module.exports = { mixOrder };
