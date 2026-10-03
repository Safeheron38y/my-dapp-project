'use strict';
const fs = require('fs');
const path = require('path');

const CONF_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');

// 替换 ${VAR} / ${VAR:-default}
function subst(v) {
  if (typeof v === 'string') {
    return v.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (_, n, d) =>
      process.env[n] !== undefined && process.env[n] !== '' ? process.env[n] : d !== undefined ? d : '');
  }
  if (Array.isArray(v)) return v.map(subst);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = subst(v[k]);
    return o;
  }
  return v;
}
function load(name) {
  return subst(JSON.parse(fs.readFileSync(path.join(CONF_DIR, name), 'utf8')));
}

const providers = load('providers.json').providers;
const regions = load('regions.json');
const catalog = load('games.json');

// 合并 HUIDU 精选清单(games.huidu-shortlist.json)：品类取并集(以 shortlist 的顺序为准)，游戏按 id 去重追加。
// 设置 CATALOG_HUIDU=0 可不加载（目录为空）。
function mergeCatalog() {
  if (process.env.CATALOG_HUIDU === '0') return;
  const f = path.join(CONF_DIR, 'games.huidu-shortlist.json');
  if (!fs.existsSync(f)) return;
  const sl = load('games.huidu-shortlist.json');
  const cats = Object.assign({}, catalog.categories); // 以 games.json 的品类顺序/名称为准，清单里多出的品类追加在后
  for (const k of Object.keys(sl.categories || {})) if (!cats[k]) cats[k] = sl.categories[k];
  catalog.categories = cats;
  const seen = new Set(catalog.games.map((g) => g.id));
  for (const g of sl.games || []) if (!seen.has(g.id)) { seen.add(g.id); catalog.games.push(g); }
}
mergeCatalog();

module.exports = {
  providers, regions, catalog,
  env: {
    port: Number(process.env.PORT) || 8088,
    host: process.env.HOST || '0.0.0.0',
    // enforce | log | off —— 供应商回调签名校验模式。生产必须 enforce
    signatureMode: process.env.SIGNATURE_MODE || 'enforce',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    mockAdmin: process.env.MOCK_ADMIN !== '0', // 开发用：结算体育注单/模拟供应商
    publicDir: process.env.PUBLIC_DIR || path.join(__dirname, '..', '..', 'public'),
    publicBase: process.env.PUBLIC_BASE_URL || '',
    tsToleranceSec: Number(process.env.SIGNATURE_TOLERANCE_SEC) || 300,
  },
};
