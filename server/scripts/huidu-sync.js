'use strict';
// 用法：HUIDU_BASE_URL=… HUIDU_AGENCY_UID=… HUIDU_AES_KEY=… node scripts/huidu-sync.js [--write]
//   · 拉取 /game/providers + /game/list，与本地目录对比，打印 新增/下架 摘要；
//   · --write 把远端完整目录写到 config/games.huidu-synced.json（不会覆盖精选清单，需人工审阅后再并入）。
//   · 无凭据时使用本地模拟器（HUIDU_SIMULATOR=auto），仅用于演示。
const fs = require('fs');
const path = require('path');
const adapters = require('../adapters');
const config = require('../lib/config');
(async () => {
  const ad = adapters.get('huidu_seamless');
  if (!ad) { console.error('huidu_seamless 未启用'); process.exit(1); }
  if (ad.isDemo()) console.warn('⚠ 未配置真实凭据，使用本地模拟器');
  const diff = await ad.syncCatalog();
  console.log(`远端 ${diff.remote} 款｜新增 ${diff.added.length}｜远端缺失/下架 ${diff.retired.length}｜未变 ${diff.unchanged}`);
  for (const g of diff.added.slice(0, 20)) console.log('  + ', g.vendor, g.name, g.providerGameId);
  for (const g of diff.retired.slice(0, 20)) console.log('  - ', g.vendor, g.name, g.providerGameId);
  if (process.argv.includes('--write')) {
    const out = path.join(__dirname, '..', 'config', 'games.huidu-synced.json');
    fs.writeFileSync(out, JSON.stringify({ _comment: 'HUIDU 远端目录快照（未并入）。', categories: config.catalog.categories, games: await ad.listGames() }, null, 1));
    console.log('已写入', out);
  }
  process.exit(0);
})().catch((e) => { console.error(e.code || '', e.message); process.exit(1); });
