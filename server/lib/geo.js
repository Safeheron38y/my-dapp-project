'use strict';
const { regions, catalog } = require('./config');

// 地区解析顺序：用户账户注册地区 > 反向代理注入的头(X-Region，生产应由 CDN/网关根据 IP 设置并剥离客户端同名头) > defaultRegion。
// 生产环境请接入真实 Geo-IP 服务，并在网关层覆盖/删除客户端传来的 X-Region。
function resolveRegion(code) {
  return regions.regions[code] ? code : regions.defaultRegion;
}
function regionCfg(code) { return regions.regions[resolveRegion(code)]; }

function categoriesFor(code) {
  const c = regionCfg(code).categories;
  const out = {};
  // 默认全部开放：只有显式写 false 才关闭（新增品类不需要同步改 regions.json）。平台不做按国家/地区的游戏过滤。
  for (const k of Object.keys(catalog.categories)) out[k] = !(c && c[k] === false);
  return out;
}
// 只有显式 false 才关闭；未知/新增品类默认开放
function categoryEnabled(code, cat) { const c = regionCfg(code).categories; return !(c && c[cat] === false); }

// 限额：null/undefined = 不设上限
function limitsFor(code, cat) {
  const r = regionCfg(code);
  const base = Object.assign({ minBet: null, maxBet: null, minDeposit: null, maxDeposit: null, maxDailyDeposit: null }, r.limits || {});
  const cl = (cat && r.categoryLimits && r.categoryLimits[cat]) || {};
  return Object.assign(base, cl);
}
module.exports = { resolveRegion, regionCfg, categoriesFor, categoryEnabled, limitsFor };
