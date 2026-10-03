'use strict';
// 启动服务器(随机端口、独立进程内) 并测试 bet/win/rollback/refund 幂等、签名、限额、地区等。运行：node test/run.js
process.env.PORT = '0';
// 持久化写入临时目录(测试结束即弃)；加快 scrypt 以缩短测试时间(生产默认 N=16384)
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), '8k-test-'));
process.env.PERSIST_DELAY_MS = '50'; process.env.SCRYPT_N = '1024';
process.env.ADMIN_LOGIN_RATE_LIMIT = '100000';
// 测试必须离线且确定：强制使用 HUIDU 本地模拟器（随机凭据），不读取开发者环境里的任何 HUIDU_* 真实凭据
process.env.LOGIN_RATE_LIMIT_PER_MIN = '100000';
process.env.HUIDU_SIMULATOR = 'on'; process.env.HUIDU_WALLET_MODE = 'shared';
for (const k of ['HUIDU_BASE_URL', 'HUIDU_AGENCY_UID', 'HUIDU_AES_KEY']) delete process.env[k];
const assert = require('assert');
const { server } = require('../index.js');
const sign = require('../lib/sign');
const config = require('../lib/config');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hc = require('../lib/huidu-crypto');
const alias = require('../lib/alias');
const wallet = require('../lib/wallet');
const store = require('../lib/store');
const adapters = require('../adapters');
const { createSimulator } = require('../sim/huidu-sim');
const HDADAPTER_helpers = () => require('../adapters/huidu').helpers;

let base, passed = 0, failed = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); passed++; results.push('  ✔ ' + name); }
  catch (e) { failed++; results.push('  ✘ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}
async function api(method, path, body, token, headers) {
  const r = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, headers), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
async function cb(provider, action, payload, opt = {}) {
  const raw = JSON.stringify(payload), ts = String(opt.ts || Date.now());
  const secret = opt.secret || (config.providers[provider] || {}).secret;
  const h = { 'Content-Type': 'application/json' };
  if (!opt.noSig) { h['X-Timestamp'] = ts; h['X-Signature'] = opt.sig || sign.sign(secret, ts, raw); }
  const r = await fetch(`${base}/provider/${provider}/${action}`, { method: 'POST', headers: h, body: raw });
  return { status: r.status, body: await r.json() };
}
let n = 0; const uniq = (p) => `${p}-${Date.now()}-${++n}`;
async function newUser(region) {
  const r = await api('POST', '/api/auth/register', { username: uniq('u').replace(/[^\w-]/g, ''), password: 'Pass1234x', region });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id, balance: r.body.wallet.balance };
}
const bal = async (u) => (await api('GET', '/api/wallet', null, u.token)).body.balance;
const P = 'demo_slot_a';

// ---- 夹具(运行期注入，不属于发布配置) ----
// 1) 一个 mock 电子游戏(发布目录里电子游戏都来自 HUIDU 清单)，用于覆盖 mock 适配器的 launch / mock 回调。
config.catalog.games.push({ id: 'slot-01', name: '测试老虎机', category: 'slots', subcategory: 'video', provider: 'demo_slot_a', type: 'iframe', orientation: 'landscape', tags: [], demo: true });
// 2) 受限地区：发布的 regions.json 只有 default(全开放、无限额)；这里注入限制地区只为验证“开关/限额机制”仍可用。
const ALL_ON = { slots: true, fishing: true, live: true, table: true, crash: true, sports: true };
config.regions.regions.region_a = { label: 'T-A', categories: ALL_ON, limits: { minBet: 1, maxBet: 5000, minDeposit: 10, maxDeposit: 50000, maxDailyDeposit: 100000 }, categoryLimits: { crash: { maxBet: 500 }, slots: { maxBet: 1000 } }, ageGate: 21 };
config.regions.regions.region_c = { label: 'T-C', categories: Object.assign({}, ALL_ON, { slots: false, fishing: false, live: false, table: false, crash: false }), limits: {}, ageGate: 18 };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  console.log('测试服务器', base);

  await t('GET /api/games 过滤：category / provider / q / tag', async () => {
    const a = await api('GET', '/api/games?category=slots'); assert(a.body.games.length >= 10 && a.body.games.every((g) => g.category === 'slots'));
    const b = await api('GET', '/api/games?provider=demo_live_a'); assert(b.body.games.length && b.body.games.every((g) => g.provider === 'demo_live_a'));
    const c = await api('GET', '/api/games?q=' + encodeURIComponent('百家乐')); assert(c.body.games.length >= 2);
    const d = await api('GET', '/api/games?tag=hot'); assert(d.body.games.every((g) => g.tags.includes('hot')));
  });
  await t('login → wallet', async () => {
    const u = await newUser(); assert.strictEqual(u.balance, 1000); assert.strictEqual(await bal(u), 1000);
    assert.strictEqual((await api('GET', '/api/wallet')).status, 401);
  });
  // 玩家密码认证 / 后台管理 / 持久化（test/auth-admin.js）。放在目录被其它测试改动之前，便于断言 186 款。
  await require('./auth-admin')({ t, api, cb, base: () => base, uniq, config, store, P });

  await t('回调签名：缺失/错误/过期/篡改 → 401 且不动账', async () => {
    const u = await newUser(); const p = { userId: u.id, txId: uniq('s'), amount: 10, roundId: 'r1' };
    assert.strictEqual((await cb(P, 'bet', p, { noSig: true })).status, 401);
    assert.strictEqual((await cb(P, 'bet', p, { secret: 'wrong' })).status, 401);
    assert.strictEqual((await cb(P, 'bet', p, { ts: Date.now() - 3600e3 })).status, 401);
    const raw = JSON.stringify(p), ts = String(Date.now());
    const r = await fetch(`${base}/provider/${P}/bet`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timestamp': ts, 'X-Signature': sign.sign(config.providers[P].secret, ts, raw) }, body: JSON.stringify(Object.assign({}, p, { amount: 1 })) });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(await bal(u), 1000);
  });
  await t('balance 回调', async () => {
    const u = await newUser(); const r = await cb(P, 'balance', { userId: u.id });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.balance, 1000);
    assert.strictEqual((await cb(P, 'balance', { userId: 'nope' })).status, 404);
  });
  await t('bet 幂等：同 txId 重复 3 次只扣一次', async () => {
    const u = await newUser(); const p = { userId: u.id, txId: uniq('b'), amount: 25.5, roundId: 'rA' };
    const r1 = await cb(P, 'bet', p); assert.strictEqual(r1.status, 200); assert.strictEqual(r1.body.balance, 974.5); assert.notStrictEqual(r1.body.duplicate, true);
    const r2 = await cb(P, 'bet', p), r3 = await cb(P, 'bet', p);
    assert.strictEqual(r2.body.duplicate, true); assert.strictEqual(r3.body.duplicate, true);
    assert.strictEqual(r2.body.balance, 974.5); assert.strictEqual(await bal(u), 974.5);
    const tx = (await api('GET', '/api/transactions?type=bet', null, u.token)).body; assert.strictEqual(tx.transactions.length, 1);
  });
  await t('bet 同 txId 不同金额 → 409 IDEMPOTENCY_CONFLICT', async () => {
    const u = await newUser(); const id = uniq('c');
    await cb(P, 'bet', { userId: u.id, txId: id, amount: 10 });
    const r = await cb(P, 'bet', { userId: u.id, txId: id, amount: 11 });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.body.code, 'IDEMPOTENCY_CONFLICT'); assert.strictEqual(await bal(u), 990);
  });
  await t('win 幂等：重复派彩只加一次', async () => {
    const u = await newUser(); const bid = uniq('b'), wid = uniq('w');
    await cb(P, 'bet', { userId: u.id, txId: bid, amount: 100, roundId: 'rW' });
    const w = { userId: u.id, txId: wid, amount: 250, roundId: 'rW' };
    const r1 = await cb(P, 'win', w), r2 = await cb(P, 'win', w);
    assert.strictEqual(r1.body.balance, 1150); assert.strictEqual(r2.body.duplicate, true); assert.strictEqual(await bal(u), 1150);
    const z = await cb(P, 'win', { userId: u.id, txId: uniq('w0'), amount: 0, roundId: 'rW' }); assert.strictEqual(z.status, 200); assert.strictEqual(await bal(u), 1150);
  });
  await t('bet 余额不足 → 402 且余额不变；非法金额(3位小数/负数/0)被拒', async () => {
    const u = await newUser();
    const r = await cb(P, 'bet', { userId: u.id, txId: uniq('x'), amount: 5000 }); assert.strictEqual(r.status, 402); assert.strictEqual(r.body.code, 'INSUFFICIENT_FUNDS');
    for (const a of [0, -5, 1.234, 'abc', null]) { const q = await cb(P, 'bet', { userId: u.id, txId: uniq('x'), amount: a }); assert.strictEqual(q.status, 400, 'amount=' + a); }
    assert.strictEqual(await bal(u), 1000);
  });
  await t('rollback bet：退回本金；重复 rollback(相同/不同 txId) 不重复退款', async () => {
    const u = await newUser(); const bid = uniq('b'), rid = uniq('rb');
    await cb(P, 'bet', { userId: u.id, txId: bid, amount: 40, roundId: 'rR' }); assert.strictEqual(await bal(u), 960);
    const rb = { userId: u.id, txId: rid, refTxId: bid };
    const r1 = await cb(P, 'rollback', rb); assert.strictEqual(r1.status, 200); assert.strictEqual(r1.body.balance, 1000);
    const r2 = await cb(P, 'rollback', rb); assert.strictEqual(r2.body.duplicate, true); assert.strictEqual(r2.body.balance, 1000);
    const r3 = await cb(P, 'rollback', { userId: u.id, txId: uniq('rb2'), refTxId: bid }); assert.strictEqual(r3.status, 200); assert.strictEqual(r3.body.alreadyReversed, true); assert.strictEqual(await bal(u), 1000);
    const r4 = await cb(P, 'refund', { userId: u.id, txId: uniq('rf'), refTxId: bid }); assert.strictEqual(r4.body.alreadyReversed, true); assert.strictEqual(await bal(u), 1000);
  });
  await t('refund bet：退款一次；原 bet 重放仍不再扣款', async () => {
    const u = await newUser(); const bid = uniq('b');
    await cb(P, 'bet', { userId: u.id, txId: bid, amount: 60, roundId: 'rF' });
    const r = await cb(P, 'refund', { userId: u.id, txId: uniq('rf'), refTxId: bid }); assert.strictEqual(r.body.balance, 1000);
    const again = await cb(P, 'bet', { userId: u.id, txId: bid, amount: 60, roundId: 'rF' }); assert.strictEqual(again.status, 200); assert.strictEqual(again.body.duplicate, true); assert.strictEqual(await bal(u), 1000);
  });
  await t('rollback win：扣回派彩一次', async () => {
    const u = await newUser(); const bid = uniq('b'), wid = uniq('w');
    await cb(P, 'bet', { userId: u.id, txId: bid, amount: 10, roundId: 'rX' });
    await cb(P, 'win', { userId: u.id, txId: wid, amount: 30, roundId: 'rX' }); assert.strictEqual(await bal(u), 1020);
    const rb = { userId: u.id, txId: uniq('rb'), refTxId: wid };
    await cb(P, 'rollback', rb); assert.strictEqual(await bal(u), 990);
    await cb(P, 'rollback', rb); assert.strictEqual(await bal(u), 990);
    const rf = await cb(P, 'refund', { userId: u.id, txId: uniq('rf'), refTxId: wid }); assert.strictEqual(rf.status, 409); // refund 仅用于 bet
  });
  await t('乱序：rollback 先于 bet 到达 → 之后的 bet 被拒绝且不扣款', async () => {
    const u = await newUser(); const bid = uniq('b');
    const rb = await cb(P, 'rollback', { userId: u.id, txId: uniq('rb'), refTxId: bid }); assert.strictEqual(rb.status, 200); assert.strictEqual(rb.body.refFound, false);
    const b = await cb(P, 'bet', { userId: u.id, txId: bid, amount: 50, roundId: 'rO' }); assert.strictEqual(b.status, 409); assert.strictEqual(b.body.code, 'TX_CANCELLED');
    assert.strictEqual(await bal(u), 1000);
  });
  await t('轮次已冲正后 win 被拒绝(ROUND_CANCELLED)', async () => {
    const u = await newUser(); const bid = uniq('b');
    await cb(P, 'bet', { userId: u.id, txId: bid, amount: 20, roundId: 'rC' });
    await cb(P, 'rollback', { userId: u.id, txId: uniq('rb'), refTxId: bid });
    const w = await cb(P, 'win', { userId: u.id, txId: uniq('w'), amount: 40, roundId: 'rC' }); assert.strictEqual(w.status, 409); assert.strictEqual(w.body.code, 'ROUND_CANCELLED'); assert.strictEqual(await bal(u), 1000);
  });
  await t('并发：20 个相同 txId 的 bet 并行 → 只扣一次', async () => {
    const u = await newUser(); const p = { userId: u.id, txId: uniq('par'), amount: 7, roundId: 'rP' };
    const rs = await Promise.all(Array.from({ length: 20 }, () => cb(P, 'bet', p)));
    assert(rs.every((r) => r.status === 200)); assert.strictEqual(rs.filter((r) => !r.body.duplicate).length, 1); assert.strictEqual(await bal(u), 993);
  });
  await t('账务守恒：一串操作后 余额 = 初始 + Σ(ledger)', async () => {
    const u = await newUser(); const ids = [];
    for (let i = 0; i < 5; i++) { const id = uniq('b'); ids.push(id); await cb(P, 'bet', { userId: u.id, txId: id, amount: 10 + i, roundId: 'rL' + i }); }
    await cb(P, 'win', { userId: u.id, txId: uniq('w'), amount: 33.33, roundId: 'rL1' });
    await cb(P, 'rollback', { userId: u.id, txId: uniq('rb'), refTxId: ids[2] });
    await cb(P, 'refund', { userId: u.id, txId: uniq('rf'), refTxId: ids[3] });
    const txs = (await api('GET', '/api/transactions?limit=200', null, u.token)).body.transactions;
    let sum = 1000; for (const e of txs) { if (e.type === 'bet') sum -= e.amount; else if (e.type === 'win' || e.type === 'rollback' || e.type === 'refund') sum += e.amount; }
    assert.strictEqual(Math.round(sum * 100), Math.round((await bal(u)) * 100));
  });
  await t('提供商不存在/回调 404；GET 方法 405', async () => {
    assert.strictEqual((await cb('nope', 'bet', { userId: 'x' }, { noSig: true })).status, 404);
    assert.strictEqual((await api('GET', '/provider/demo_slot_a/bet')).status, 405);
  });
  await t('launch：返回 iframe URL + token；自研游戏返回内置窗口', async () => {
    const u = await newUser();
    const a = await api('POST', '/api/games/slot-01/launch', { device: 'mobile' }, u.token); assert.strictEqual(a.status, 200); assert(a.body.url.includes('provider-game.html') && a.body.launchToken); assert.strictEqual(a.body.orientation, 'landscape');
    const b = await api('POST', '/api/games/crash/launch', {}, u.token); assert.strictEqual(b.body.window, '/games/crash.html');
    assert.strictEqual((await api('POST', '/api/games/slot-01/launch', {})).status, 401);
    assert.strictEqual((await api('POST', '/api/games/nope/launch', {}, u.token)).status, 404);
    // 用 launchToken 驱动 mock iframe 游戏：bet+win 走回调
    const s = await api('POST', '/api/mock/provider-spin', { token: a.body.launchToken, amount: 5 }); assert.strictEqual(s.status, 200); assert.strictEqual(typeof s.body.balance, 'number');
  });
  await t('地区：region_c 仅体育 → 其它品类 launch/games/bet 被拒', async () => {
    const u = await newUser('region_c');
    const g = await api('GET', '/api/games?region=region_c'); assert(g.body.games.every((x) => x.category === 'sports'));
    assert.strictEqual((await api('POST', '/api/games/slot-01/launch', {}, u.token)).status, 403);
    const b = await cb(P, 'bet', { userId: u.id, txId: uniq('g'), amount: 5, gameId: 'slot-01' }); assert.strictEqual(b.status, 403); assert.strictEqual(b.body.code, 'CATEGORY_DISABLED');
  });
  await t('限额：region_a 最高投注 5000/Crash 500；default 无上限', async () => {
    const a = await newUser('region_a'); const d = await newUser('default');
    // 先充值到足够
    await api('POST', '/api/wallet/deposit', { amount: 50000 }, a.token);
    const over = await cb(P, 'bet', { userId: a.id, txId: uniq('l'), amount: 6000, gameId: 'slot-01' }); assert.strictEqual(over.status, 400); assert.strictEqual(over.body.code, 'ABOVE_MAX_BET');
    const slotOver = await cb(P, 'bet', { userId: a.id, txId: uniq('l'), amount: 1500, gameId: 'slot-01' }); assert.strictEqual(slotOver.body.code, 'ABOVE_MAX_BET'); // 老虎机 1000
    const ok = await cb(P, 'bet', { userId: a.id, txId: uniq('l'), amount: 900, gameId: 'slot-01' }); assert.strictEqual(ok.status, 200);
    const crash = await api('POST', '/api/inhouse/crash/start', { amount: 600 }, a.token); assert.strictEqual(crash.body.code, 'ABOVE_MAX_BET');
    await api('POST', '/api/wallet/deposit', { amount: 1000000 }, d.token); // default 无充值上限
    assert.strictEqual(await bal(d), 1001000);
    const big = await cb(P, 'bet', { userId: d.id, txId: uniq('l'), amount: 900000 }); assert.strictEqual(big.status, 200);
    const minDep = await api('POST', '/api/wallet/deposit', { amount: 1 }, a.token); assert.strictEqual(minDep.body.code, 'BELOW_MIN_DEPOSIT');
  });
  await t('负责任博彩桩：自我排除后 bet/launch 被拒', async () => {
    const u = await newUser();
    const ex = await api('POST', '/api/rg/exclude', { hours: 1 }, u.token); assert.strictEqual(ex.status, 200);
    const b = await cb(P, 'bet', { userId: u.id, txId: uniq('e'), amount: 5 }); assert.strictEqual(b.status, 403); assert.strictEqual(b.body.code, 'SELF_EXCLUDED');
    assert.strictEqual((await api('POST', '/api/games/slot-01/launch', {}, u.token)).status, 403);
  });
  await t('体育：下注、赔率变动保护、Idempotency-Key 重放、串关、结算', async () => {
    const u = await newUser();
    const ev = (await api('GET', '/api/sports/events')).body.events.find((e) => !e.live);
    const o = ev.markets[0].outcomes[0];
    const sel = [{ eventId: ev.id, marketId: ev.markets[0].id, outcomeId: o.id, odds: o.odds }];
    const key = 'idem-' + uniq('k');
    const r1 = await api('POST', '/api/sports/bets', { selections: sel, stake: 20, type: 'single' }, u.token, { 'Idempotency-Key': key });
    assert.strictEqual(r1.status, 200); assert.strictEqual(r1.body.balance, 980);
    const r2 = await api('POST', '/api/sports/bets', { selections: sel, stake: 20, type: 'single' }, u.token, { 'Idempotency-Key': key });
    assert.strictEqual(r2.status, 200); assert.strictEqual(await bal(u), 980); assert.strictEqual(r2.body.bet.id, r1.body.bet.id);
    const stale = [Object.assign({}, sel[0], { odds: o.odds + 0.5 })];
    const ch = await api('POST', '/api/sports/bets', { selections: stale, stake: 5, type: 'single' }, u.token); assert.strictEqual(ch.status, 409); assert.strictEqual(ch.body.code, 'ODDS_CHANGED'); assert.strictEqual(await bal(u), 980);
    const ev2 = (await api('GET', '/api/sports/events')).body.events.filter((e) => !e.live)[1]; const o2 = ev2.markets[0].outcomes[0];
    const par = await api('POST', '/api/sports/bets', { type: 'parlay', stake: 10, selections: [sel[0], { eventId: ev2.id, marketId: 'm1', outcomeId: o2.id, odds: o2.odds }] }, u.token); assert.strictEqual(par.status, 200);
    assert(Math.abs(par.body.bet.totalOdds - Math.round(o.odds * o2.odds * 100) / 100) < 0.011);
    const s = await api('POST', `/api/sports/bets/${r1.body.bet.id}/settle`, { result: 'void' }, u.token); assert.strictEqual(s.status, 200); assert.strictEqual(await bal(u), 990);
    const s2 = await api('POST', `/api/sports/bets/${r1.body.bet.id}/settle`, { result: 'won' }, u.token); assert.strictEqual(s2.status, 409);
    assert.strictEqual((await api('POST', '/api/sports/bets', { selections: sel, stake: 1.234 }, u.token)).status, 400);
  });
  await t('自研小游戏：Plinko/Mines/Crash 账务一致，无法重复提现', async () => {
    const u = await newUser();
    const pl = await api('POST', '/api/inhouse/plinko/drop', { amount: 10, rows: 12, risk: 'med' }, u.token); assert.strictEqual(pl.status, 200);
    assert.strictEqual(pl.body.path.length, 12); assert.strictEqual(Math.round(pl.body.balance * 100), Math.round((990 + pl.body.payout) * 100));
    const m = await api('POST', '/api/inhouse/mines/start', { amount: 10, mines: 3 }, u.token); assert.strictEqual(m.status, 200);
    assert.strictEqual((await api('POST', '/api/inhouse/mines/cashout', { roundId: m.body.roundId }, u.token)).body.code, 'NOTHING_OPENED');
    let idx = 0, res; do { res = await api('POST', '/api/inhouse/mines/reveal', { roundId: m.body.roundId, idx: idx++ }, u.token); } while (!res.body.hit && idx < 3 && res.status === 200);
    if (!res.body.hit) { const c1 = await api('POST', '/api/inhouse/mines/cashout', { roundId: m.body.roundId }, u.token); assert.strictEqual(c1.status, 200); const c2 = await api('POST', '/api/inhouse/mines/cashout', { roundId: m.body.roundId }, u.token); assert.strictEqual(c2.status, 409); }
    const cr = await api('POST', '/api/inhouse/crash/start', { amount: 5 }, u.token); assert.strictEqual(cr.status, 200);
    assert.strictEqual((await api('POST', '/api/inhouse/crash/start', { amount: 5 }, u.token)).status, 409);
    const ck = await api('POST', '/api/inhouse/crash/cashout', { roundId: cr.body.roundId }, u.token); assert.strictEqual(ck.status, 200); // 起飞前 1.00x 立即提现 = 退回本金
    assert.strictEqual((await api('POST', '/api/inhouse/crash/cashout', { roundId: cr.body.roundId }, u.token)).status, 409);
  });
  await t('转账钱包：转入/转出 + 幂等', async () => {
    const u = await newUser(); const key = 'tr-' + uniq('t');
    const a = await api('POST', '/api/wallet/transfer', { provider: 'demo_transfer', direction: 'in', amount: 100 }, u.token, { 'Idempotency-Key': key }); assert.strictEqual(a.status, 200); assert.strictEqual(a.body.balance, 900);
    const b = await api('POST', '/api/wallet/transfer', { provider: 'demo_transfer', direction: 'in', amount: 100 }, u.token, { 'Idempotency-Key': key }); assert.strictEqual(b.body.balance, 900);
    const c = await api('POST', '/api/wallet/transfer', { provider: 'demo_transfer', direction: 'out' }, u.token); assert.strictEqual(c.body.balance, 1000);
    assert.strictEqual((await api('POST', '/api/wallet/transfer', { provider: 'demo_slot_a', direction: 'in', amount: 1 }, u.token)).status, 400);
    const cbr = await cb('demo_transfer', 'bet', { userId: u.id, txId: uniq('x'), amount: 1 }); assert.strictEqual(cbr.status, 409);
  });
  await t('静态资源：路径穿越被拒；API 404 JSON', async () => {
    const r = await fetch(base + '/..%2f..%2fserver%2fconfig%2fproviders.json'); assert([400, 403, 404].includes(r.status));
    const r2 = await fetch(base + '/%2e%2e/server/index.js'); assert([400, 403, 404].includes(r2.status));
    assert.strictEqual((await api('GET', '/api/nope')).status, 404);
  });

  // =====================================================================
  //  配置 / 目录 / 地区（用户要求：全部地区与品类默认开放、不做地区过滤、不设固定限额）
  // =====================================================================
  await t('regions.json：只有 default，全部品类开放，所有限额为 null（发布配置，不含注入夹具）', async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'regions.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(raw.regions), ['default']);
    const d = raw.regions.default;
    for (const c of Object.keys(config.catalog.categories)) assert.strictEqual(d.categories[c], true, c);
    for (const [k, v] of Object.entries(d.limits)) assert.strictEqual(v, null, k);
    assert.deepStrictEqual(d.categoryLimits, {});
    // 任意（含未知）地区码得到完全相同的目录；缺失的品类配置按“开放”处理
    const a = await api('GET', '/api/games?limit=1000'), b = await api('GET', '/api/games?limit=1000&region=cn'), c = await api('GET', '/api/games?limit=1000', null, null, { 'X-Region': 'US' });
    assert.strictEqual(a.body.total, b.body.total); assert.strictEqual(a.body.total, c.body.total);
    assert(a.body.categories.every((x) => x.enabled));
    assert.strictEqual(require('../lib/geo').categoryEnabled('default', 'brand_new_category_not_in_config'), true);
  });
  await t('目录：HUIDU 清单 170 款已加载（含 fishing 10 款），保留自研 Crash/Plinko/Mines 与视讯/体育外壳', async () => {
    const r = (await api('GET', '/api/games?limit=1000')).body;
    const hd = r.games.filter((g) => g.provider === 'huidu_seamless');
    assert.strictEqual(hd.length, 170);
    assert.deepStrictEqual(r.categories.map((c) => c.id), ['slots', 'fishing', 'live', 'table', 'crash', 'sports']);
    assert.strictEqual(r.categories.find((c) => c.id === 'fishing').label, '捕鱼');
    assert.strictEqual(r.games.filter((g) => g.category === 'fishing').length, 10);
    assert.strictEqual(r.games.filter((g) => g.category === 'slots' && g.provider === 'huidu_seamless').length, 80);
    for (const id of ['crash', 'plinko', 'mines']) assert(r.games.some((g) => g.id === id && g.provider === 'inhouse' && g.type === 'inhouse'), id);
    assert(r.games.some((g) => g.category === 'live' && g.type === 'live') && r.games.some((g) => g.category === 'sports' && g.type === 'sports'));
    assert(hd.every((g) => g.vendor && !('providerGameId' in g) && !('regionNotes' in g) && g.playable));
    assert.strictEqual(new Set(r.games.map((g) => g.id)).size, r.games.length);
    // 目录里的 providerGameId 全部唯一（内部字段，不对外）
    const ids = config.catalog.games.filter((g) => g.provider === 'huidu_seamless').map((g) => g.providerGameId);
    assert.strictEqual(new Set(ids).size, 170);
  });
  await t('搜索：中文别名(麻将/捕鱼)、厂商过滤、分页上限', async () => {
    const m = (await api('GET', '/api/games?q=' + encodeURIComponent('麻将'))).body; assert.strictEqual(m.total, 4); assert(m.games.every((g) => /mahjong/i.test(g.name)));
    const f = (await api('GET', '/api/games?q=' + encodeURIComponent('捕鱼'))).body; assert(f.total >= 10 && f.games.some((g) => g.category === 'fishing'));
    const v = (await api('GET', '/api/games?vendor=PGSoft')).body; assert(v.total >= 5 && v.games.every((g) => g.vendor === 'PGSoft'));
    const pg = (await api('GET', '/api/games?limit=50&page=2')).body; assert.strictEqual(pg.games.length, 50); assert.strictEqual(pg.page, 2);
  });
  await t('限制地区机制仍可用（注入夹具）：region_c 仅体育；shipped default 不受影响', async () => {
    const r = (await api('GET', '/api/games?region=region_c&limit=1000')).body; assert(r.games.every((g) => g.category === 'sports'));
    const d = (await api('GET', '/api/games?limit=1000')).body; assert(d.total > 150);
  });

  // =====================================================================
  //  HUIDU：加密 / 别名 / settle / 回调 / 模拟器 / 转账钱包 / 目录同步 / 对账
  // =====================================================================
  const HD = 'huidu_seamless';
  const ad = adapters.get(HD);
  const HDCFG = config.providers[HD];
  const gameOf = (id) => config.catalog.games.find((g) => g.id === id);
  const GAME = gameOf('pg-mahjong-ways');

  await t('HUIDU 加密：已知答案向量(openssl aes-256-ecb 生成) + 往返 + 错误处理', async () => {
    const key = 'abcdefghijklmnopqrstuvwxyz012345'; // 测试用虚构密钥
    assert.strictEqual(hc.encrypt('{"hello":"world","n":1}', key), '44lmPmymlivOQrpC+mz3DkMIzrrjmPK9ELAZVAUEJj0=');
    assert.deepStrictEqual(hc.decrypt('44lmPmymlivOQrpC+mz3DkMIzrrjmPK9ELAZVAUEJj0=', key), { hello: 'world', n: 1 });
    // 对象与字符串明文等价；中文/emoji/长文本往返；输出为标准 Base64(含 +/=)
    const o = { member_account: 'k8abc', note: '中文🎰', amounts: ['-1.50', '0.00', '1000000.01'], big: 'x'.repeat(5000) };
    const e = hc.encrypt(o, key); assert(/^[A-Za-z0-9+/]+={0,2}$/.test(e)); assert.deepStrictEqual(hc.decrypt(e, key), o); assert.strictEqual(hc.encrypt(JSON.stringify(o), key), e);
    // ECB 特性（文档所选方案）：相同 16 字节块 → 相同密文块；无 IV → 确定性
    const two = Buffer.from(hc.encrypt('A'.repeat(32), key), 'base64'); assert.strictEqual(two.subarray(0, 16).toString('hex'), two.subarray(16, 32).toString('hex'));
    assert.strictEqual(hc.encrypt(o, key), hc.encrypt(o, key));
    // 与 Node 原生 aes-256-ecb 逐字节一致（密钥 = 32 个 ASCII 字符的 UTF-8 字节，PKCS7）
    const c = crypto.createCipheriv('aes-256-ecb', Buffer.from(key, 'utf8'), null); assert.strictEqual(e, Buffer.concat([c.update(JSON.stringify(o), 'utf8'), c.final()]).toString('base64'));
    // 错误：密钥错误 / 非 Base64 / 空串 / 密文被截断 / 明文不是 JSON 对象 → 统一 payload error
    const bad = ['', 'not base64!!', e.slice(0, -4), hc.encrypt('plain text', key), hc.encrypt('123', key)];
    for (const b of bad) assert.throws(() => hc.decrypt(b, key), (er) => er.name === 'HuiduCryptoError' && er.message === 'payload error', b);
    assert.throws(() => hc.decrypt(e, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'), /payload error/);
    // 密钥必须正好 32 字节
    for (const k of ['short', 'a'.repeat(31), 'a'.repeat(33), '中'.repeat(11), null, 123]) assert.throws(() => hc.encrypt({ a: 1 }, k), /aes key/);
    assert(hc.validKey('a'.repeat(32)) && !hc.validKey('a'.repeat(31)));
  });
  await t('源码不含硬编码密钥/32 位十六进制凭据（adapters/huidu.js、sim、huidu-crypto、providers.json）', async () => {
    for (const f of ['adapters/huidu.js', 'sim/huidu-sim.js', 'lib/huidu-crypto.js', 'lib/alias.js', 'config/providers.json']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      assert(!/\b[0-9a-f]{32}\b/i.test(src), f + ' 含 32 位十六进制串');
      assert(!/jsgame\.live/.test(src), f + ' 含文档示例地址');
    }
    const pj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'providers.json'), 'utf8')).providers.huidu_seamless;
    assert.strictEqual(pj.apiKey, '${HUIDU_AGENCY_UID:-}'); assert.strictEqual(pj.secret, '${HUIDU_AES_KEY:-}'); assert.strictEqual(pj.baseUrl, '${HUIDU_BASE_URL:-}');
  });
  await t('member_account 别名：仅 a-z0-9、3~20 位、稳定、可反查、互不相同', async () => {
    const us = []; for (let i = 0; i < 300; i++) us.push(store.createUser(uniq('al').replace(/[^\w-]/g, ''), 'default'));
    const set = new Set();
    for (const u of us) {
      const a = alias.aliasFor('p_test', u.id, 'k8');
      assert(/^[a-z0-9]{3,20}$/.test(a), a); assert(a.startsWith('k8')); assert.strictEqual(alias.aliasFor('p_test', u.id, 'k8'), a);
      assert.strictEqual(alias.resolve('p_test', a), u.id); assert(!set.has(a)); set.add(a);
      assert(!a.includes(u.id.replace(/^u_/, '')));
    }
    assert.notStrictEqual(alias.aliasFor('p_other', us[0].id, 'k8'), alias.aliasFor('p_test', us[0].id, 'k8'));
    assert.strictEqual(alias.resolve('p_test', 'k8doesnotexist'), null); assert.strictEqual(alias.resolve('p_test', 'K8UPPER'), null); assert.strictEqual(alias.resolve('p_test', 'a_b'), null); assert.strictEqual(alias.resolve('p_test', 'ab'), null);
    assert(/^[a-z0-9]{3,20}$/.test(alias.aliasFor('p_test', us[0].id.replace('u_', 'Q_-'), 'Weird_Prefix!!')) );
    assert.strictEqual(alias.aliasFor('p_x', 'u_zzz', '').slice(0, 2), 'k8');
  });

  await t('wallet.settle：bet+win 单条账本、0 金额、负数=退款/追扣、余额不足不入账、幂等与冲突', async () => {
    const u = await newUser(); const S = (o) => wallet.settle(Object.assign({ provider: 'p_settle', userId: u.id, roundId: 'rS' }, o));
    const a = S({ txId: 's1', betMinor: 1000, winMinor: 2500 }); assert.strictEqual(a.view.balance, 1015); assert.strictEqual(a.view.type, 'settle'); assert.strictEqual(a.view.amount, 15);
    const a2 = S({ txId: 's1', betMinor: 1000, winMinor: 2500 }); assert.strictEqual(a2.duplicate, true); assert.strictEqual(a2.view.balance, 1015); assert.strictEqual(await bal(u), 1015);
    assert.throws(() => S({ txId: 's1', betMinor: 1000, winMinor: 2600 }), (e) => e.code === 'IDEMPOTENCY_CONFLICT');
    S({ txId: 's2', betMinor: 0, winMinor: 0 }); assert.strictEqual(await bal(u), 1015);            // 0/0
    S({ txId: 's3', betMinor: 0, winMinor: 500 }); assert.strictEqual(await bal(u), 1020);          // 免费旋转派彩
    S({ txId: 's4', betMinor: 300, winMinor: 0 }); assert.strictEqual(await bal(u), 1017);          // 输局
    S({ txId: 's5', betMinor: -300, winMinor: 0 }); assert.strictEqual(await bal(u), 1020);         // 负 bet = 退款
    S({ txId: 's6', betMinor: 0, winMinor: -500 }); assert.strictEqual(await bal(u), 1015);         // 负 win = 追扣
    assert.throws(() => S({ txId: 's7', betMinor: 0, winMinor: -999999 }), (e) => e.code === 'INSUFFICIENT_FUNDS' && e.http === 402);
    assert.throws(() => S({ txId: 's8', betMinor: 999999, winMinor: 0 }), (e) => e.code === 'INSUFFICIENT_FUNDS');
    assert.strictEqual(await bal(u), 1015);
    assert.throws(() => S({ txId: 's9', betMinor: 1.5, winMinor: 0 }), (e) => e.code === 'INVALID_AMOUNT');
    assert.throws(() => S({ txId: 'bad id', betMinor: 1, winMinor: 0 }), (e) => e.code === 'INVALID_TX_ID');
    // 失败后用同一 txId 在余额充足时重试可以成功（失败不占用幂等键）
    S({ txId: 's8', betMinor: 100, winMinor: 0 }); assert.strictEqual(await bal(u), 1014);
    // 守恒：Σ ledger.amount = 余额变化
    const sum = store.ledgerOf(u.id).filter((e) => e.provider === 'p_settle').reduce((x, e) => x + e.amount, 0); assert.strictEqual(sum, 1400);
    // 仅 bet>0 才做限额 / 品类 / 负责任博彩检查：自我排除期间退款与派彩仍可入账
    const ex = await newUser(); await api('POST', '/api/rg/exclude', { hours: 1 }, ex.token);
    assert.throws(() => wallet.settle({ provider: 'p_settle', userId: ex.id, txId: 'x1', betMinor: 100, winMinor: 0 }), (e) => e.code === 'SELF_EXCLUDED');
    wallet.settle({ provider: 'p_settle', userId: ex.id, txId: 'x2', betMinor: 0, winMinor: 100 }); wallet.settle({ provider: 'p_settle', userId: ex.id, txId: 'x3', betMinor: -50, winMinor: 0 });
    assert.strictEqual(await bal(ex), 1001.5);
  });

  // ---- HUIDU 回调辅助 ----
  const HDMEM = (u) => alias.aliasFor(HD, u.id, HDCFG.aliasPrefix);
  const hdPlain = (u, o) => Object.assign({ serial_number: crypto.randomUUID(), currency_code: ad.currency, game_uid: GAME.providerGameId, member_account: HDMEM(u), win_amount: '0.00', bet_amount: '0.00', timestamp: String(Date.now()), game_round: 'r' + crypto.randomBytes(4).toString('hex') }, o);
  const hdEnv = (plain, o) => Object.assign({ agency_uid: ad.agencyUid, timestamp: String(Date.now()), payload: hc.encrypt(plain, ad.aesKey) }, o);
  async function hdPost(body) {
    const r = await fetch(`${base}/provider/${HD}/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const j = await r.json(); let pl = null;
    if (typeof j.payload === 'string') { try { pl = hc.decrypt(j.payload, ad.aesKey); } catch { pl = 'UNDECRYPTABLE'; } }
    return { status: r.status, code: j.code, msg: j.msg, pl, balance: pl && pl.credit_amount != null ? Number(pl.credit_amount) : null, body: j };
  }
  const hdSettle = (u, o) => hdPost(hdEnv(hdPlain(u, o)));

  await t('HUIDU 回调：单一 URL、加密响应、credit_amount=余额-bet+win、HTTP 200', async () => {
    const u = await newUser();
    const r = await hdSettle(u, { bet_amount: '10.00', win_amount: '25.50' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.code, 0); assert.strictEqual(r.msg, ''); assert.strictEqual(r.pl.credit_amount, '1015.50'); assert(/^\d{13}$/.test(r.pl.timestamp));
    assert.strictEqual(typeof r.body.payload, 'string'); assert.strictEqual(await bal(u), 1015.5);
    const tx = (await api('GET', '/api/transactions?type=settle', null, u.token)).body.transactions; assert.strictEqual(tx.length, 1); assert.strictEqual(tx[0].bet, 10); assert.strictEqual(tx[0].win, 25.5); assert.strictEqual(tx[0].amount, 15.5);
    // 数字型金额、整数字符串、带多余的 0 也接受
    assert.strictEqual((await hdSettle(u, { bet_amount: 1, win_amount: '0' })).balance, 1014.5);
    assert.strictEqual((await hdSettle(u, { bet_amount: '1.500', win_amount: '0.00' })).balance, 1013);
    // 老的按 action 的路径对 HUIDU 不适用（没有 balance/bet/win 回调）
    const old = await fetch(`${base}/provider/${HD}/bet`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hdEnv(hdPlain(u, { bet_amount: '1.00' }))) }); assert.strictEqual(old.status, 404); assert.strictEqual(await bal(u), 1013);
    assert.strictEqual((await api('GET', `/provider/${HD}/callback`)).status, 405);
    assert.strictEqual((await api('POST', '/provider/demo_slot_a/callback', {})).status, 404); // 模板适配器没有通用入口
  });
  await t('HUIDU settle 幂等：同 serial_number 重试 → code 0 + 最新余额，只入账一次；同号异载荷 → code 1', async () => {
    const u = await newUser(); const p = hdPlain(u, { bet_amount: '40.00', win_amount: '10.00' });
    const r1 = await hdPost(hdEnv(p)); assert.strictEqual(r1.balance, 970);
    const r2 = await hdPost(hdEnv(p)), r3 = await hdPost(hdEnv(p));
    assert.strictEqual(r2.code, 0); assert.strictEqual(r2.balance, 970); assert.strictEqual(r3.balance, 970); assert.strictEqual(await bal(u), 970);
    assert.strictEqual((await api('GET', '/api/transactions?type=settle', null, u.token)).body.transactions.length, 1);
    // 重试时“最新余额”：期间余额变化后，重试返回的是最新值，而不是首次值
    await api('POST', '/api/wallet/deposit', { amount: 100 }, u.token);
    assert.strictEqual((await hdPost(hdEnv(p))).balance, 1070);
    const c = await hdPost(hdEnv(Object.assign({}, p, { win_amount: '99.00' }))); assert.strictEqual(c.code, 1); assert.strictEqual(c.msg, 'IDEMPOTENCY_CONFLICT'); assert.strictEqual(c.balance, 1070); assert.strictEqual(await bal(u), 1070);
  });
  await t('HUIDU 负数=退款 / 0 金额 / 余额不足：失败也返回余额（code=1），不动账', async () => {
    const u = await newUser();
    assert.strictEqual((await hdSettle(u, { bet_amount: '100.00', win_amount: '0.00' })).balance, 900);
    const rf = await hdSettle(u, { bet_amount: '-100.00', win_amount: '0.00' }); assert.strictEqual(rf.code, 0); assert.strictEqual(rf.balance, 1000);   // 负 bet = 退款
    assert.strictEqual((await hdSettle(u, { bet_amount: '0.00', win_amount: '-30.00' })).balance, 970);                                              // 负 win = 追扣
    assert.strictEqual((await hdSettle(u, { bet_amount: '0.00', win_amount: '0.00' })).balance, 970);                                                // 0/0
    assert.strictEqual((await hdSettle(u, { bet_amount: '0', win_amount: '12.34' })).balance, 982.34);                                               // 免费旋转
    const lack = await hdSettle(u, { bet_amount: '5000.00', win_amount: '0.00' });
    assert.strictEqual(lack.status, 200); assert.strictEqual(lack.code, 1); assert.strictEqual(lack.msg, 'INSUFFICIENT_FUNDS'); assert.strictEqual(lack.balance, 982.34); assert.strictEqual(await bal(u), 982.34);
    const over = await hdSettle(u, { bet_amount: '0.00', win_amount: '-5000.00' }); assert.strictEqual(over.code, 1); assert.strictEqual(over.balance, 982.34);
    // 余额不足的那条之后可用同一 serial 在余额充足时重试
    const pending = hdPlain(u, { bet_amount: '2000.00', win_amount: '0.00' });
    assert.strictEqual((await hdPost(hdEnv(pending))).code, 1); await api('POST', '/api/wallet/deposit', { amount: 5000 }, u.token);
    const again = await hdPost(hdEnv(pending)); assert.strictEqual(again.code, 0); assert.strictEqual(again.balance, 3982.34);
  });
  await t('HUIDU 非法回调：错误 agency / 错误密钥 / 乱码 / 缺字段 / 非法金额 / 币种 / 未知玩家 / 过期时间戳 / 非 JSON', async () => {
    const u = await newUser(); const before = await bal(u);
    const p = hdPlain(u, { bet_amount: '10.00', win_amount: '0.00' });
    const r1 = await hdPost(hdEnv(p, { agency_uid: 'someoneelse' })); assert.strictEqual(r1.status, 200); assert.strictEqual(r1.code, 1); assert.strictEqual(r1.msg, 'agency error');
    const r2 = await hdPost(hdEnv(p, { payload: hc.encrypt(p, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345') })); assert.strictEqual(r2.code, 1); assert.strictEqual(r2.msg, 'payload error'); assert.strictEqual(r2.pl, null);
    const r3 = await hdPost(hdEnv(p, { payload: 'AAAA' })); assert.strictEqual(r3.code, 1);
    const r4 = await hdPost({ agency_uid: ad.agencyUid, timestamp: '1' }); assert.strictEqual(r4.code, 1);
    const r5 = await hdPost('this is not json'); assert.strictEqual(r5.status, 200); assert.strictEqual(r5.code, 1);
    const r6 = await hdPost(hdEnv(Object.assign({}, p, { serial_number: undefined }))); assert.strictEqual(r6.code, 1); assert.strictEqual(r6.msg, 'INVALID_PARAMS'); assert.strictEqual(r6.balance, before);
    for (const bad of ['abc', '1.234', '1e3', '', null, '--1', '1,000']) { const r = await hdSettle(u, { bet_amount: bad }); assert.strictEqual(r.code, 1, 'bet_amount=' + bad); assert.strictEqual(r.msg, 'INVALID_AMOUNT'); assert.strictEqual(r.balance, before); }
    const r7 = await hdSettle(u, { currency_code: 'EUR' }); assert.strictEqual(r7.code, 1); assert.strictEqual(r7.msg, 'CURRENCY_MISMATCH');
    const r8 = await hdSettle(u, { member_account: 'k8unknownplayer' }); assert.strictEqual(r8.code, 1); assert.strictEqual(r8.msg, 'PLAYER_NOT_FOUND'); assert.strictEqual(r8.balance, 0);
    const r9 = await hdSettle(u, { member_account: 'Bad_Account!' }); assert.strictEqual(r9.code, 1);
    const r10 = await hdSettle(u, { timestamp: String(Date.now() - 3 * 86400e3) }); assert.strictEqual(r10.code, 1); assert.strictEqual(r10.msg, 'timestamp out of range');
    const r11 = await hdSettle(u, { timestamp: 'garbage' }); assert.strictEqual(r11.code, 1);
    assert.strictEqual(await bal(u), before);
    // 文档自相矛盾的 timestamp 两种格式都接受（毫秒 / "yyyy-MM-dd HH:mm:ss" UTC+0）
    const f = new Date().toISOString().replace('T', ' ').slice(0, 19);
    assert.strictEqual((await hdSettle(u, { timestamp: f, bet_amount: '1.00' })).code, 0); assert.strictEqual((await hdSettle(u, { timestamp: Date.now(), bet_amount: '1.00' })).code, 0);
    assert.strictEqual(await bal(u), before - 2);
  });
  await t('HUIDU 并发：20 个相同 serial_number 并行 → 只入账一次', async () => {
    const u = await newUser(); const env = hdEnv(hdPlain(u, { bet_amount: '7.00', win_amount: '0.00' }));
    const rs = await Promise.all(Array.from({ length: 20 }, () => hdPost(env)));
    assert(rs.every((r) => r.code === 0 && r.balance === 993)); assert.strictEqual(await bal(u), 993);
    assert.strictEqual(store.ledgerOf(u.id).filter((e) => e.provider === HD).length, 1);
  });
  await t('HUIDU 回调：IP 白名单生效时拒绝非白名单来源（403），并发不影响其它供应商', async () => {
    const u = await newUser(); HDCFG.ipAllowlist = ['203.0.113.9'];
    try { const r = await fetch(`${base}/provider/${HD}/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hdEnv(hdPlain(u, { bet_amount: '1.00' }))) }); assert.strictEqual(r.status, 403); assert.strictEqual(await bal(u), 1000); }
    finally { HDCFG.ipAllowlist = []; }
  });

  // ---- 模拟器启动流 ----
  await t('HUIDU 模拟器(共享钱包)：launch → 模拟器会话 → 加密回调结算 → 重发幂等 → 账务一致', async () => {
    const u = await newUser();
    const l = await api('POST', '/api/games/pg-mahjong-ways/launch', { device: 'mobile', lang: 'zh-CN', returnUrl: 'https://example.test/back?x=1#f' }, u.token);
    assert.strictEqual(l.status, 200); assert.strictEqual(l.body.mode, 'demo'); assert.strictEqual(l.body.walletMode, 'shared'); assert.strictEqual(l.body.type, 'iframe');
    const q = new URL(l.body.url, base).searchParams; const sid = q.get('session'); assert(l.body.url.startsWith('/demo/huidu-game.html?')); assert(sid && q.get('provider') === HD);
    await ad.ensureReady(); const sim = ad.sim; const sess = sim.session(sid);
    assert.strictEqual(sess.member, HDMEM(u)); assert(/^[a-z0-9]{3,20}$/.test(sess.member)); assert.strictEqual(sess.game_uid, GAME.providerGameId);
    assert.strictEqual(sess.callback_url, `${base}/provider/${HD}/callback`); assert.strictEqual(sess.platform, '2'); assert.strictEqual(sess.lang, 'zh'); assert.strictEqual(sess.home_url, 'https://example.test/back'); // home_url 剔除 ? 和 #
    assert.strictEqual(sim.playerOf(sess.member).currency, 'USD');
    const r1 = await sim.play({ session: sid, bet: 10, win: 25, round: 'rd1' }); assert(r1.ok); assert.strictEqual(r1.balance, 1015); assert.strictEqual(r1.plain.bet_amount, '10.00'); assert.strictEqual(r1.plain.win_amount, '25.00');
    const rr = await sim.resend(r1.serial_number); assert(rr.ok); assert.strictEqual(rr.balance, 1015); assert.strictEqual(await bal(u), 1015);
    const r2 = await sim.play({ session: sid, bet: 5000, win: 0, retry: 2 }); assert.strictEqual(r2.ok, false); assert.strictEqual(r2.attempts, 3); assert.strictEqual(r2.balance, 1015); assert.strictEqual(r2.msg, 'INSUFFICIENT_FUNDS'); // 失败也带余额；重试 3 次
    const r3 = await sim.play({ session: sid, bet: -10, win: 0 }); assert.strictEqual(r3.balance, 1025);                // 退款
    const r4 = await sim.play({ session: sid, bet: 0, win: 0 }); assert.strictEqual(r4.balance, 1025);
    // 演示 iframe 走 /api/mock/huidu-spin
    const sp = await api('POST', '/api/mock/huidu-spin', { provider: HD, session: sid, amount: 5 }); assert.strictEqual(sp.status, 200); assert.strictEqual(typeof sp.body.balance, 'number'); assert.strictEqual(sp.body.balance, await bal(u));
    // 余额不足以覆盖净额(win-bet<0)时失败（净额为正则按 HUIDU 语义放行：settle 是 bet+win 的合并结算）
    const big = await sim.play({ session: sid, bet: 99999, win: 0 }); assert.strictEqual(big.ok, false); assert.strictEqual(big.msg, 'INSUFFICIENT_FUNDS');
    assert.strictEqual((await api('POST', '/api/mock/huidu-spin', { provider: HD, session: 'nope', amount: 1 })).status, 400);
    // 账务守恒
    const txs = (await api('GET', '/api/transactions?limit=200', null, u.token)).body.transactions; let sum = 1000; for (const e of txs) if (e.type === 'settle') sum += e.amount;
    assert.strictEqual(Math.round(sum * 100), Math.round((await bal(u)) * 100));
    assert.strictEqual((await api('GET', '/api/transactions?type=settle', null, u.token)).body.transactions.length, 4);
  });
  await t('HUIDU 启动错误映射：维护 10034→503 / 冻结 10016→403 / 未知游戏→404 / 币种锁定 10011→409', async () => {
    const u = await newUser(); await ad.ensureReady(); const sim = ad.sim;
    sim.setFail('maintenance', true); const m = await api('POST', '/api/games/pg-mahjong-ways/launch', {}, u.token); sim.setFail('maintenance', false);
    assert.strictEqual(m.status, 503); assert.strictEqual(m.body.code, 'PROVIDER_MAINTENANCE'); assert.strictEqual(m.body.providerCode, 10034);
    sim.freeze(HDMEM(u)); const f = await api('POST', '/api/games/pg-mahjong-ways/launch', {}, u.token); assert.strictEqual(f.status, 403); assert.strictEqual(f.body.code, 'ACCOUNT_FROZEN');
    const u2 = await newUser(); const g = config.catalog.games.find((x) => x.id === 'pg-mahjong-ways');
    config.catalog.games.push({ id: 'tmp-bad-uid', name: 'x', category: 'slots', subcategory: 'video', provider: HD, type: 'iframe', orientation: 'any', tags: [], providerGameId: '0'.repeat(32), vendor: 'PGSoft' });
    const n = await api('POST', '/api/games/tmp-bad-uid/launch', {}, u2.token); assert.strictEqual(n.status, 404); assert.strictEqual(n.body.code, 'GAME_NOT_FOUND');
    config.catalog.games.push({ id: 'tmp-no-uid', name: 'y', category: 'slots', subcategory: 'video', provider: HD, type: 'iframe', orientation: 'any', tags: [] });
    assert.strictEqual((await api('POST', '/api/games/tmp-no-uid/launch', {}, u2.token)).status, 404);
    sim.playerOf(HDMEM(u2)); sim.state.players.set(HDMEM(u2), { member: HDMEM(u2), currency: 'EUR', balance: 0 });
    const c = await api('POST', '/api/games/pg-mahjong-ways/launch', {}, u2.token); assert.strictEqual(c.status, 409); assert.strictEqual(c.body.code, 'CURRENCY_MISMATCH');
    config.catalog.games = config.catalog.games.filter((x) => !/^tmp-/.test(x.id)); void g;
  });
  await t('HUIDU 真实模式配置路径：凭据来自配置(环境变量)，指向独立模拟器进程；错误密钥/长度非法/缺凭据', async () => {
    const key = crypto.randomBytes(16).toString('hex'), uid = crypto.randomBytes(16).toString('hex');
    const sim = createSimulator({ agencyUid: uid, aesKey: key, walletMode: 'shared' }); const url = await sim.listen(0, '127.0.0.1');
    const cfg = (o) => Object.assign({}, HDCFG, { enabled: true, simulator: 'off', baseUrl: url, apiKey: uid, secret: key, timeoutMs: 3000 }, o);
    const real = adapters.register('huidu_real', cfg());
    const u = await newUser();
    const r = await real.launch({ user: store.users.get(u.id), game: GAME, device: 'desktop', lang: 'en-US', currency: 'DEMO', launchToken: 'x', returnUrl: 'https://h.test/', callbackBase: `${base}/provider/huidu_real` });
    assert.strictEqual(r.mode, 'real'); assert(r.url.startsWith(url + '/sim/game?session='));
    const s = sim.session(new URL(r.url).searchParams.get('session')); assert.strictEqual(s.platform, '1'); assert.strictEqual(s.lang, 'en'); assert.strictEqual(s.member, alias.aliasFor('huidu_real', u.id, 'k8'));
    // 错误 AES 密钥 → 供应商 10004 → PROVIDER_PAYLOAD_ERROR
    const wrong = adapters.register('huidu_wrongkey', cfg({ secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' }));
    await assert.rejects(wrong.launch({ user: store.users.get(u.id), game: GAME, device: 'mobile', lang: 'zh', currency: 'DEMO', callbackBase: base }), (e) => e.code === 'PROVIDER_PAYLOAD_ERROR');
    // 错误 agency → 10002
    const wa = adapters.register('huidu_wrongagency', cfg({ apiKey: 'nobody' }));
    await assert.rejects(wa.launch({ user: store.users.get(u.id), game: GAME, device: 'mobile', lang: 'zh', currency: 'DEMO', callbackBase: base }), (e) => e.code === 'PROVIDER_AUTH_FAILED');
    // 密钥长度非法 / 缺凭据 → 配置错误，启动游戏 503 PROVIDER_NOT_CONFIGURED，且不发任何请求
    for (const o of [{ secret: 'tooshort' }, { secret: '' }, { apiKey: '' }, { baseUrl: '' }]) {
      const a = adapters.register('huidu_cfgerr', cfg(o)); assert(a.configError, JSON.stringify(o));
      await assert.rejects(a.launch({ user: store.users.get(u.id), game: GAME, device: 'mobile', lang: 'zh', currency: 'DEMO', callbackBase: base }), (e) => e.code === 'PROVIDER_NOT_CONFIGURED' && e.http === 503);
      assert.strictEqual(a.decodeCallback({ body: { payload: 'AAAA' } }).ok, false);
    }
    // 超时（供应商不响应）→ 504 PROVIDER_TIMEOUT
    const to = adapters.register('huidu_timeout', cfg({ timeoutMs: 250 })); sim.setFail('hang', true);
    await assert.rejects(to.launch({ user: store.users.get(u.id), game: GAME, device: 'mobile', lang: 'zh', currency: 'DEMO', callbackBase: base }), (e) => e.code === 'PROVIDER_TIMEOUT' && e.http === 504);
    sim.setFail('hang', false); await sim.close();
  });
  await t('HUIDU 启动 v1 参数校验（模拟器复刻文档错误码）：10015/10023/10008/10033/10024/10013', async () => {
    const sim = createSimulator({ agencyUid: 'agencyx', aesKey: crypto.randomBytes(16).toString('hex'), walletMode: 'shared' }); const url = await sim.listen(0, '127.0.0.1');
    const call = async (path, body) => { const r = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agency_uid: sim.agencyUid, timestamp: String(Date.now()), payload: hc.encrypt(body, sim.aesKey) }) }); return r.json(); };
    const ok = { member_account: 'abc123', game_uid: GAME.providerGameId, credit_amount: '10.00', currency_code: 'USD', callback_url: 'http://x/cb' };
    assert.strictEqual((await call('/game/v1', ok)).code, 0);
    assert.strictEqual((await call('/game/v1', Object.assign({}, ok, { member_account: 'AB_c' }))).code, 10015);
    assert.strictEqual((await call('/game/v1', Object.assign({}, ok, { member_account: 'ab' }))).code, 10023);
    assert.strictEqual((await call('/game/v1', Object.assign({}, ok, { game_uid: 'nope' }))).code, 10008);
    assert.strictEqual((await call('/game/v1', Object.assign({}, ok, { home_url: 'http://h/?a=1' }))).code, 10033);
    assert.strictEqual((await call('/game/v1', Object.assign({}, ok, { currency_code: 'ZZZ' }))).code, 10013);
    assert.strictEqual((await call('/game/v2', Object.assign({}, ok, { transfer_id: 't1' }))).code, 10024); // 共享钱包代理不能调 v2
    assert.strictEqual((await (await fetch(url + '/game/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agency_uid: 'other', timestamp: '1', payload: 'x' }) })).json()).code, 10002);
    assert.strictEqual((await (await fetch(url + '/game/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agency_uid: sim.agencyUid, timestamp: '1', payload: 'AAAA' }) })).json()).code, 10004);
    await sim.close();
  });

  // ---- 转账钱包 ----
  await t('HUIDU 转账钱包：自动转入启动 / 手动转入转出 / transfer_id 幂等 / 失败冲回 / 超时登记 pending', async () => {
    const tcfg = Object.assign({}, HDCFG, { enabled: true, walletMode: 'transfer', simulator: 'on', baseUrl: '', apiKey: '', secret: '', timeoutMs: 400 });
    const tr = adapters.register('huidu_transfer', tcfg); assert.strictEqual(tr.walletMode, 'transfer');
    config.catalog.games.push(Object.assign({}, GAME, { id: 'xfer-game', provider: 'huidu_transfer' }));
    await tr.ensureReady(); const sim = tr.sim; assert.strictEqual(sim.walletMode, 'transfer');
    const u = await newUser(); const mem = tr.name && alias.aliasFor('huidu_transfer', u.id, 'k8');
    // 手动转入 + 幂等
    const key = 'tr-' + uniq('k');
    const a = await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'in', amount: 300 }, u.token, { 'Idempotency-Key': key }); assert.strictEqual(a.status, 200); assert.strictEqual(a.body.balance, 700); assert.strictEqual(a.body.providerBalance, 300);
    const a2 = await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'in', amount: 300 }, u.token, { 'Idempotency-Key': key }); assert.strictEqual(a2.body.balance, 700); assert.strictEqual(sim.playerOf(mem).balance, 30000);
    // 启动：默认 autoTransfer=all → 剩余 700 全部转入，同时拿到启动 URL
    const l = await api('POST', '/api/games/xfer-game/launch', { transferAmount: 200 }, u.token); assert.strictEqual(l.status, 200); assert.strictEqual(l.body.walletMode, 'transfer'); assert.strictEqual(l.body.balance, 500); assert.strictEqual(l.body.providerBalance, 500);
    assert.strictEqual(sim.playerOf(mem).balance, 50000);
    // 玩家在模拟器里玩（转账钱包：不回调平台）
    const sid = new URL(l.body.url, base).searchParams.get('session'); const p = await sim.play({ session: sid, bet: 100, win: 350 }); assert(p.ok); assert.strictEqual(p.balance, 750); assert.strictEqual(await bal(u), 500);
    // 转出全部：以供应商余额(750)为准，平台余额回到 1250
    const o = await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'out' }, u.token, { 'Idempotency-Key': 'out-' + uniq('k') }); assert.strictEqual(o.status, 200); assert.strictEqual(o.body.transferred, 750); assert.strictEqual(o.body.balance, 1250); assert.strictEqual(sim.playerOf(mem).balance, 0);
    // 转出幂等：同 key 再发 → 不再动账
    const okey = 'out2-' + uniq('k'); await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'in', amount: 50 }, u.token); const o1 = await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'out' }, u.token, { 'Idempotency-Key': okey }); const o2 = await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'out' }, u.token, { 'Idempotency-Key': okey });
    assert.strictEqual(o1.body.balance, 1250); assert.strictEqual(o2.body.balance, 1250); assert.strictEqual(o2.body.transferred, 50);
    // 转出超过供应商余额 → 402
    assert.strictEqual((await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'out', amount: 10 }, u.token)).status, 402);
    // 转入失败(transfer_status=2) → 本地冲回
    const before = await bal(u); sim.failNext('transfer');
    const f1 = await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'in', amount: 100 }, u.token); assert.strictEqual(f1.status, 502); assert.strictEqual(f1.body.code, 'TRANSFER_FAILED'); assert.strictEqual(await bal(u), before);
    sim.setFail('transfer', 'code10026'); const f2 = await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'in', amount: 100 }, u.token); assert.strictEqual(f2.status, 502); assert.strictEqual(await bal(u), before);
    assert.strictEqual(sim.playerOf(mem).balance, 0);
    // 启动时转账失败 → 启动失败且资金冲回
    sim.failNext('transfer'); const f3 = await api('POST', '/api/games/xfer-game/launch', { transferAmount: 100 }, u.token); assert.strictEqual(f3.status, 502); assert.strictEqual(await bal(u), before);
    // 供应商 10025：转出超过其余额（本地镜像不阻止，由供应商拒绝）
    // 超时(结果未知)：转入本地保留扣款并登记 pending，不擅自冲回
    sim.setFail('hang', true); const t1 = await api('POST', '/api/wallet/transfer', { provider: 'huidu_transfer', direction: 'in', amount: 20 }, u.token); sim.setFail('hang', false);
    assert.strictEqual(t1.status, 504); assert.strictEqual(t1.body.code, 'PROVIDER_TIMEOUT'); assert.strictEqual(await bal(u), before - 20); assert.strictEqual(tr.pendingTransfers().length, 1); assert.strictEqual(tr.pendingTransfers()[0].dir, 'in');
    // 共享钱包适配器不接受转账；转账适配器不接受共享回调（409）
    assert.strictEqual((await api('POST', '/api/wallet/transfer', { provider: HD, direction: 'in', amount: 1 }, u.token)).status, 400);
    const cbr = await fetch(`${base}/provider/huidu_transfer/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agency_uid: tr.agencyUid, timestamp: '1', payload: hc.encrypt(hdPlain(u), tr.aesKey) }) }); const cj = await cbr.json(); assert.strictEqual(cj.code, 1); assert.strictEqual(cj.msg, 'WALLET_MODE_MISMATCH');
    // 模拟器 10027：同一 transfer_id 重复
    const dup = await tr._post('/game/v2', { member_account: 'zzz999', currency_code: 'USD', transfer_id: 'dup-1', credit_amount: '1.00' });
    assert(dup.payload.transfer_id === 'dup-1'); await assert.rejects(tr._post('/game/v2', { member_account: 'zzz999', currency_code: 'USD', transfer_id: 'dup-1', credit_amount: '1.00' }), (e) => e.code === 'TRANSFER_EXISTS' && e.extra.providerCode === 10027);
    // autoTransfer=none：启动不转入
    tr.cfg.autoTransfer = 'none'; const l2 = await api('POST', '/api/games/xfer-game/launch', {}, u.token); assert.strictEqual(l2.status, 200); assert.strictEqual(l2.body.balance, before - 20); tr.cfg.autoTransfer = 'all';
  });

  // ---- 目录同步 ----
  await t('HUIDU 目录同步：providers/list 解析、status=0 与下架厂商不入库、diff/apply', async () => {
    await ad.ensureReady(); const sim = ad.sim;
    const provs = await ad.listProviders(); assert(provs.length >= 30 && provs.some((p) => p.status === 0));
    const one = await ad.listProviders({ code: 'pgsoft' }); assert.strictEqual(one.length, 1); assert.strictEqual(one[0].name, 'PGSoft');
    const games = await ad.listGames();
    assert(!games.some((g) => g.vendor === 'RetiredVendor-已下架')); assert(!games.some((g) => g.providerGameId === 'e'.repeat(32))); // 下架厂商/status=0 游戏被过滤
    assert.strictEqual(games.length, 170); assert(games.every((g) => g.provider === HD && g.type === 'iframe' && g.providerGameId && g.vendor));
    assert.strictEqual(games.filter((g) => g.category === 'fishing').length, 10); assert.strictEqual(games.filter((g) => g.category === 'slots').length, 80);
    assert.strictEqual(HDADAPTER_helpers().mapType('Fish'), 'fishing');
    // diff：新增 1 款、下架 1 款（远端 status=0）；apply 之前目录不变
    const n0 = config.catalog.games.length;
    sim.catalog.games.push({ code: 'pgsoft', game_uid: 'a1'.repeat(16), game_name: 'Brand New Slot', game_type: 'Slot', lang: 'en', status: 1, currency: 'USD' });
    const victim = sim.catalog.games.find((g) => g.game_uid === gameOf('pg-mahjong-ways-2').providerGameId); victim.status = 0;
    const d = await ad.syncCatalog(); assert.strictEqual(d.added.length, 1); assert.strictEqual(d.added[0].name, 'Brand New Slot'); assert.strictEqual(d.retired.length, 1); assert.strictEqual(d.retired[0].id, 'pg-mahjong-ways-2'); assert.strictEqual(config.catalog.games.length, n0);
    const d2 = await ad.syncCatalog({ apply: true }); assert.strictEqual(config.catalog.games.length, n0); // +1 新增 -1 下架
    assert(config.catalog.games.some((g) => g.name === 'Brand New Slot')); assert(!config.catalog.games.some((g) => g.id === 'pg-mahjong-ways-2')); assert.strictEqual(d2.added.length, 1);
    assert.strictEqual((await ad.syncCatalog()).added.length, 0);
    // 复原，避免影响后续用例
    victim.status = 1; await ad.syncCatalog({ apply: true });
  });

  // ---- 对账 ----
  await t('HUIDU 对账：按 UTC 日分页拉 transaction/list，与本地账本按 serial_number 比对（匹配/本地缺失/金额不一致/远端缺失）', async () => {
    const u = await newUser(); await ad.ensureReady(); const sim = ad.sim;
    const today = new Date().toISOString().slice(0, 10);
    // 之前的用例是直接向回调入口 POST（模拟器不知情）→ 这些“本地有、远端无”的记录作为基线
    const base0 = await ad.reconcile({ date: today }); assert.strictEqual(base0.missingLocal.length, 0); assert.strictEqual(base0.mismatched.length, 0);
    const l = await api('POST', '/api/games/pg-mahjong-ways/launch', {}, u.token); const sid = new URL(l.body.url, base).searchParams.get('session');
    for (let i = 0; i < 7; i++) assert((await sim.play({ session: sid, bet: 1 + i, win: i % 2 ? 3 : 0 })).ok);
    const r = await ad.reconcile({ date: today, pageSize: 3 }); // 强制分页
    assert.strictEqual(r.missingLocal.length, 0); assert.strictEqual(r.mismatched.length, 0); assert.strictEqual(r.missingRemote.length, base0.missingRemote.length); assert.strictEqual(r.matched, base0.matched + 7); assert.strictEqual(r.remoteTotal, base0.remoteTotal + 7);
    // 远端有、本地没有
    sim.recordSilently({ member: HDMEM(u), bet: 9, win: 0, game_uid: GAME.providerGameId, serial: 'silent-1' });
    // 本地金额被改（模拟账务异常）
    const e = store.ledgerOf(u.id).find((x) => x.provider === HD && x.type === 'settle'); const keep = e.win; e.win += 100;
    // 本地有、远端没有
    wallet.settle({ provider: HD, userId: u.id, txId: 'local-only-1', betMinor: 100, winMinor: 0, roundId: 'rz', gameId: GAME.id });
    const r2 = await ad.reconcile({ date: today });
    assert.strictEqual(r2.ok, false); assert.deepStrictEqual(r2.missingLocal.map((x) => x.serial_number), ['silent-1']); assert.strictEqual(r2.mismatched.length, 1); assert.strictEqual(r2.mismatched[0].serial_number, e.txId);
    assert.strictEqual(r2.missingRemote.length, base0.missingRemote.length + 1); assert(r2.missingRemote.some((x) => x.serial_number === 'local-only-1')); e.win = keep;
    // 边界：昨天(无数据)正常；61 天前 → 供应商 10031；未来/非法日期
    assert.strictEqual((await ad.reconcile({ date: new Date(Date.now() - 86400e3).toISOString().slice(0, 10) })).remoteTotal >= 0, true);
    await assert.rejects(ad.reconcile({ date: new Date(Date.now() - 61 * 86400e3).toISOString().slice(0, 10) }), (er) => er.extra && er.extra.providerCode === 10031);
    await assert.rejects(ad.reconcile({ date: 'not-a-date' }), (er) => er.code === 'INVALID_PARAMS');
    // 模拟器自身的文档限制：不同天 10029 / 缺日期 10028 / to<=from 10032 / page_size>5000 10022
    const raw = async (p) => (await ad._post('/game/transaction/list', p).then((x) => ({ code: 0, x }), (er) => ({ code: er.extra.providerCode })));
    const T = Date.now(); const day = Math.floor(T / 86400000) * 86400000;
    assert.strictEqual((await raw({ from_date: day - 1, to_date: day + 10, page_no: 1, page_size: 10 })).code, 10029);
    assert.strictEqual((await raw({ page_no: 1, page_size: 10 })).code, 10028);
    assert.strictEqual((await raw({ from_date: day + 10, to_date: day + 5, page_no: 1, page_size: 10 })).code, 10032);
    assert.strictEqual((await raw({ from_date: day, to_date: day + 5, page_no: 1, page_size: 5001 })).code, 10022);
  });

  console.log(results.join('\n'));
  console.log(`\n通过 ${passed} / ${passed + failed}`);
  server.close(); process.exit(failed ? 1 : 0);
})();
