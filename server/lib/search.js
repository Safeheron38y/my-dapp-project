'use strict';
// 大厅搜索：名称 / id / 厂商 / 子类 / 品类名，加少量中文别名（麻将→mahjong 等）。游戏名多为英文，所以中文关键词需要别名。
const ALIASES = {
  '麻将': 'mahjong', '捕鱼': 'fish', '百家乐': 'baccarat', '龙虎': 'dragon', '轮盘': 'roulette', '骰宝': 'sicbo', '二十一点': 'blackjack', '21点': 'blackjack',
  '斗地主': 'landlord', '牛牛': 'niuniu', '炸金花': 'goldenflower', '德州': 'holdem', '体育': 'sport', '老虎机': 'slot', '电子': 'slot', '飞行': 'crash',
};
const SUB = { baccarat: '百家乐', blackjack: '二十一点', roulette: '轮盘', dragontiger: '龙虎', video: '视频老虎机', poker: '扑克', crash: 'crash', fishing: '捕鱼', sicbo: '骰宝', niuniu: '牛牛', landlord: '斗地主', goldenflower: '炸金花', holdem: '德州扑克' };
function haystack(g, catLabel) {
  return [g.name, g.id, g.vendor || '', g.subcategory, SUB[g.subcategory] || '', catLabel || '', g.providerLabel || ''].join(' ').toLowerCase();
}
function terms(q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return [];
  const out = [t];
  for (const [k, v] of Object.entries(ALIASES)) if (t.includes(k)) out.push(v);
  return out;
}
function matches(g, q, catLabel) {
  const ts = terms(q); if (!ts.length) return true;
  const h = haystack(g, catLabel);
  return ts.some((x) => h.includes(x));
}
module.exports = { ALIASES, matches, terms };
