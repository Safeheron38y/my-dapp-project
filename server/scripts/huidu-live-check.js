'use strict';
// 只读连通性检查（不花钱、不改账）：对真实 HUIDU（HUIDU_MODE=live）依次调用
//   /game/providers · /game/list · /game/transaction/list · /game/v1(取启动 URL，不进入游戏)
// 用法：HUIDU_MODE=live node server/scripts/huidu-live-check.js [member_suffix] [game_uid]
// 凭据来自环境变量 / 未提交的 .env.local。输出已脱敏（不打印 agency_uid / AES 密钥 / 完整启动 URL 的 id）。
const adapters = require('../adapters');
const config = require('../lib/config');
const DEFAULT_GAME = (config.catalog.games.find((g) => g.id === 'pg-mahjong-ways') || {}).providerGameId; // Mahjong Ways
(async () => {
  const ad = adapters.get('huidu_seamless');
  if (!ad || ad.isDemo() || ad.configError) { console.error('未处于 live 模式或配置不全：', ad && (ad.configError || 'simulator')); process.exit(2); }
  const suffix = (process.argv[2] || 'chk01').toLowerCase().replace(/[^a-z0-9]/g, '');
  const gameUid = process.argv[3] || DEFAULT_GAME;
  const step = async (name, fn) => { try { console.log('OK  ', name, JSON.stringify(await fn())); } catch (e) { console.log('FAIL', name, e.code || '', (e.message || '').slice(0, 200), e.extra && e.extra.providerCode ? 'providerCode=' + e.extra.providerCode : ''); } };
  await step('GET /game/providers', async () => { const p = await ad.listProviders(); return { count: p.length, enabled: p.filter((x) => Number(x.status) === 1).length, sample: p.slice(0, 5).map((x) => x.code) }; });
  await step('GET /game/list?code=PG', async () => { const g = await ad.listProviderGames('PG'); return { count: g.length, mahjongWays: !!g.find((x) => x.game_uid === gameUid) }; });
  await step('POST /game/transaction/list (today, UTC)', async () => { const d = Math.floor(Date.now() / 86400000) * 86400000; const r = (await ad._post('/game/transaction/list', { from_date: d, to_date: d + 86399999, page_no: 1, page_size: 30 })).payload; return { total_count: r.total_count, records: (r.records || []).length }; });
  await step('POST /game/v1 (seamless launch URL)', async () => {
    const member = ad.cfg.aliasPrefix ? String(ad.cfg.aliasPrefix).toLowerCase() + suffix : suffix;
    const r = (await ad._post('/game/v1', { member_account: member, game_uid: gameUid, credit_amount: '0.00', currency_code: ad.currency, language: 'en', platform: '1' })).payload;
    const u = new URL(r.game_launch_url); return { host: u.host, path: u.pathname, hasUrl: true };
  });
  await step('POST /game/v2 (transfer probe; expect 10024 on a seamless agency)', async () => { await ad._post('/game/v2', { member_account: String(ad.cfg.aliasPrefix || '') + suffix, currency_code: ad.currency, transfer_id: 'chk' + Date.now(), credit_amount: '0' }); return 'transfer wallet supported'; });
  process.exit(0);
})();
