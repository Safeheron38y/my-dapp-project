'use strict';
// 向（本地或已部署的）回调端点发送【加密样例回调】，验证 URL 可达 + AES/agency_uid 配置一致。
// 用法：node server/scripts/huidu-callback-test.js <base-url> <member_account> [game_uid]
//   例：node server/scripts/huidu-callback-test.js https://eightk-platform.onrender.com <PREFIX><hex> 
// 默认 bet=0 / win=0（只查询余额，不改账）；加 --spend 才会发 bet=1 win=2 的结算并重放一次验证幂等（仅限本地/测试环境！）。
// 凭据取自 HUIDU_AGENCY_UID / HUIDU_AES_KEY（环境变量或 .env.local）。不打印任何密钥。
require('../lib/env');
const config = require('../lib/config');
const crypto = require('crypto');
const hc = require('../lib/huidu-crypto');
(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const base = (args[0] || '').replace(/\/+$/, ''), member = args[1], game = args[2] || (config.catalog.games.find((g) => g.id === 'pg-mahjong-ways') || {}).providerGameId;
  const U = process.env.HUIDU_AGENCY_UID, K = process.env.HUIDU_AES_KEY;
  if (!base || !member || !U || !K) { console.error('用法: huidu-callback-test.js <base-url> <member_account> [game_uid] [--spend]; 且需 HUIDU_AGENCY_UID/HUIDU_AES_KEY'); process.exit(2); }
  const spend = process.argv.includes('--spend');
  const url = base + '/provider/huidu_seamless/callback';
  const send = async (name, env) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env) });
    const j = await r.json().catch(() => null); let bal = null;
    if (j && typeof j.payload === 'string') { try { bal = hc.decrypt(j.payload, K).credit_amount; } catch { bal = '(undecryptable)'; } }
    console.log(name.padEnd(34), 'HTTP', r.status, 'code=' + (j && j.code), 'msg=' + JSON.stringify(j && j.msg), 'credit_amount=' + bal);
  };
  const mk = (p, ts, key, agency) => ({ agency_uid: agency || U, timestamp: ts || String(Date.now()), payload: hc.encrypt(Object.assign({ currency_code: process.env.HUIDU_CURRENCY || 'USD', game_uid: game, member_account: member, game_round: p.serial_number.slice(0, 8), timestamp: String(Date.now()) }, p), key || K) });
  const serial = crypto.randomUUID();
  console.log('POST', url);
  await send(spend ? 'settle bet=1 win=2' : 'balance probe bet=0 win=0', mk({ serial_number: serial, bet_amount: spend ? '1' : '0', win_amount: spend ? '2' : '0' }));
  if (spend) await send('retry same serial (idempotent)', mk({ serial_number: serial, bet_amount: '1', win_amount: '2' }));
  await send('doc-style UTC timestamp', mk({ serial_number: crypto.randomUUID(), bet_amount: '0', win_amount: '0' }, new Date().toISOString().replace('T', ' ').slice(0, 19)));
  await send('wrong AES key (expect code=1)', mk({ serial_number: crypto.randomUUID(), bet_amount: '0', win_amount: '0' }, null, '0'.repeat(32)));
  await send('wrong agency_uid (expect code=1)', mk({ serial_number: crypto.randomUUID(), bet_amount: '0', win_amount: '0' }, null, null, '0'.repeat(32)));
})().catch((e) => { console.error(e.message); process.exit(1); });
