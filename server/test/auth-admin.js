'use strict';
// 玩家密码认证 + 后台管理 + 持久化 的集成测试。由 test/run.js 调用： await require('./auth-admin')(ctx)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

module.exports = async function ({ t, api, cb, base, uniq, config, store, P }) {
  const passwords = require('../lib/passwords');
  const A = require('../lib/adminstate');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- 后台客户端：自带 Cookie jar + CSRF ----
  async function adminClient(user = 'admin', pass = 'Admin@2026!') {
    const c = { cookie: '', csrf: '' };
    c.raw = async (method, p, body, headers) => {
      const r = await fetch(base() + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, c.cookie ? { Cookie: c.cookie } : {}, headers), body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
      return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
    };
    c.call = (method, p, body, headers) => c.raw(method, p, body, Object.assign(method === 'POST' && c.csrf ? { 'X-CSRF-Token': c.csrf } : {}, headers));
    c.get = (p) => c.call('GET', p); c.post = (p, b) => c.call('POST', p, b || {});
    const r = await c.raw('POST', '/api/admin/login', { username: user, password: pass });
    if (r.status === 200) { c.cookie = r.headers.get('set-cookie').split(';')[0]; c.csrf = r.body.csrf; }
    c.loginRes = r;
    return c;
  }
  const reg = async (name, password = 'Pass1234x') => { const r = await api('POST', '/api/auth/register', { username: name, password }); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); return { token: r.body.token, id: r.body.user.id, username: name }; };
  const money = (n) => Math.round(n * 100) / 100;
  const adm = await adminClient();
  assert.strictEqual(adm.loginRes.status, 200, '种子管理员应可登录');

  // ================= 玩家密码认证 =================
  await t('注册：成功 / 用户名重复(不区分大小写) / 弱密码 / 非法用户名', async () => {
    const n = uniq('reg').replace(/[^\w-]/g, '');
    const r = await api('POST', '/api/auth/register', { username: n, password: 'Abcd1234' });
    assert.strictEqual(r.status, 200); assert(r.body.token && r.body.registered); assert.strictEqual(r.body.wallet.balance, 1000); assert.strictEqual(r.body.user.username, n);
    assert.strictEqual((await api('POST', '/api/auth/register', { username: n.toUpperCase(), password: 'Abcd1234' })).body.code, 'USERNAME_TAKEN');
    for (const pw of ['short1', 'onlyletters', '12345678', '', undefined, 'a'.repeat(65) + '1']) assert.strictEqual((await api('POST', '/api/auth/register', { username: uniq('w').replace(/[^\w-]/g, ''), password: pw })).body.code, 'WEAK_PASSWORD', String(pw));
    assert.strictEqual((await api('POST', '/api/auth/register', { username: 'a', password: 'Abcd1234' })).body.code, 'INVALID_USERNAME');
    assert.strictEqual((await api('POST', '/api/auth/register', { username: 'bad name!', password: 'Abcd1234' })).body.code, 'INVALID_USERNAME');
  });
  await t('密码登录：正确 / 错误 / 未知用户(同样错误，防枚举) / 缺密码 / 不再支持免密登录', async () => {
    const n = uniq('lg').replace(/[^\w-]/g, ''); await reg(n);
    const ok = await api('POST', '/api/auth/login', { username: n, password: 'Pass1234x' });
    assert.strictEqual(ok.status, 200); assert(ok.body.token); assert.strictEqual(ok.body.mock, undefined);
    assert.strictEqual((await api('POST', '/api/auth/login', { username: n.toUpperCase(), password: 'Pass1234x' })).status, 200, '用户名不区分大小写');
    const bad = await api('POST', '/api/auth/login', { username: n, password: 'Wrong1234' });
    const unk = await api('POST', '/api/auth/login', { username: uniq('nobody').replace(/[^\w-]/g, ''), password: 'Wrong1234' });
    assert.strictEqual(bad.status, 401); assert.strictEqual(unk.status, 401);
    assert.strictEqual(bad.body.code, 'INVALID_CREDENTIALS'); assert.strictEqual(bad.body.message, unk.body.message);
    assert.strictEqual((await api('POST', '/api/auth/login', { username: n })).status, 400, '只给用户名不能登录');
    assert.strictEqual((await api('POST', '/api/auth/login', { username: uniq('free').replace(/[^\w-]/g, '') })).status, 400);
    assert.strictEqual((await api('GET', '/api/me', null, ok.body.token)).body.user.username, n);
  });
  await t('密码存储：scrypt 哈希（含盐，不存明文），同密码两个账号哈希不同；篡改/错误格式校验失败', async () => {
    const a = await reg(uniq('h1').replace(/[^\w-]/g, '')), b = await reg(uniq('h2').replace(/[^\w-]/g, ''));
    const ua = store.users.get(a.id), ub = store.users.get(b.id);
    assert(/^scrypt\$\d+\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(ua.pw), ua.pw); assert(!ua.pw.includes('Pass1234x')); assert.notStrictEqual(ua.pw, ub.pw);
    assert.strictEqual(await passwords.verify('Pass1234x', ua.pw), true); assert.strictEqual(await passwords.verify('Pass1234y', ua.pw), false);
    assert.strictEqual(await passwords.verify('x', 'plaintext'), false); assert.strictEqual(await passwords.verify('x', ''), false);
    const me = await api('GET', '/api/me', null, a.token); assert(!JSON.stringify(me.body).includes('scrypt'));
  });
  await t('种子演示账号：test01/02/03 (余额 10000, Test@2026) 与 admin 可登录', async () => {
    for (const n of ['test01', 'test02', 'test03']) {
      const r = await api('POST', '/api/auth/login', { username: n, password: 'Test@2026' });
      assert.strictEqual(r.status, 200, n); assert.strictEqual(r.body.wallet.balance, 10000, n);
    }
    assert.strictEqual((await api('POST', '/api/auth/login', { username: 'test01', password: 'test@2026' })).status, 401);
    assert.strictEqual(adm.loginRes.body.admin.username, 'admin');
    // 玩家账号不能登后台，管理员账号不能登前台
    assert.strictEqual((await api('POST', '/api/admin/login', { username: 'test01', password: 'Test@2026' })).status, 401);
    assert.strictEqual((await api('POST', '/api/auth/login', { username: 'admin', password: 'Admin@2026!' })).status, 401);
  });
  await t('玩家登录防爆破：连续失败达阈值后锁定（正确密码也被拒）', async () => {
    const n = uniq('lock').replace(/[^\w-]/g, ''); await reg(n);
    for (let i = 0; i < 8; i++) assert.strictEqual((await api('POST', '/api/auth/login', { username: n, password: 'Nope12345' })).status, 401);
    const r = await api('POST', '/api/auth/login', { username: n, password: 'Pass1234x' });
    assert.strictEqual(r.status, 429); assert.strictEqual(r.body.code, 'ACCOUNT_LOCKED');
  });

  // ================= 后台鉴权 =================
  await t('后台鉴权：未登录全部 401；玩家 Bearer / 后台 Cookie 互不通用', async () => {
    for (const p of ['dashboard', 'players', 'games', 'providers', 'transactions', 'settings', 'audit', 'me']) assert.strictEqual((await api('GET', '/api/admin/' + p)).status, 401, p);
    const u = await reg(uniq('np').replace(/[^\w-]/g, ''));
    assert.strictEqual((await api('GET', '/api/admin/dashboard', null, u.token)).status, 401, '玩家令牌不能访问后台');
    assert.strictEqual((await api('POST', '/api/admin/players/' + u.id + '/adjust', { amount: 5, reason: 'xx' }, u.token)).status, 401);
    const r = await fetch(base() + '/api/wallet', { headers: { Cookie: adm.cookie } }); assert.strictEqual(r.status, 401, '后台 Cookie 不能当玩家会话');
    const r2 = await fetch(base() + '/api/admin/dashboard', { headers: { Authorization: 'Bearer ' + adm.csrf, Cookie: 'k8_admin=forged' } }); assert.strictEqual(r2.status, 401);
  });
  await t('后台登录：Cookie 属性(HttpOnly/SameSite=Strict)、错误密码 401、CSRF、跨站 Origin、登出', async () => {
    const bad = await adminClient('admin', 'wrong'); assert.strictEqual(bad.loginRes.status, 401); assert.strictEqual(bad.loginRes.body.code, 'INVALID_CREDENTIALS');
    const none = await adminClient('nobody', 'wrong'); assert.strictEqual(none.loginRes.body.message, bad.loginRes.body.message);
    const c = await adminClient(); const sc = c.loginRes.headers.get('set-cookie');
    assert(/^k8_admin=[0-9a-f]{64};/.test(sc) && /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc) && /Path=\/api\/admin/.test(sc), sc);
    assert.strictEqual((await c.get('/api/admin/me')).body.admin.username, 'admin');
    assert.strictEqual((await c.raw('POST', '/api/admin/settings', { registrationOpen: true })).body.code, 'CSRF');
    assert.strictEqual((await c.call('POST', '/api/admin/settings', { registrationOpen: true }, { 'X-CSRF-Token': 'x'.repeat(c.csrf.length) })).body.code, 'CSRF');
    assert.strictEqual((await c.call('POST', '/api/admin/settings', { registrationOpen: true }, { Origin: 'https://evil.example' })).body.code, 'BAD_ORIGIN');
    assert.strictEqual((await c.post('/api/admin/settings', { registrationOpen: true })).status, 200);
    assert.strictEqual((await c.post('/api/admin/logout')).status, 200);
    assert.strictEqual((await c.get('/api/admin/me')).status, 401, '登出后旧 Cookie 失效');
  });
  await t('后台登录限流：IP 超限 → 429 + Retry-After', async () => {
    const old = process.env.ADMIN_LOGIN_RATE_LIMIT; process.env.ADMIN_LOGIN_RATE_LIMIT = '3';
    try {
      let last; for (let i = 0; i < 8; i++) { last = await adminClient('ratelimit-probe', 'bad'); if (last.loginRes.status === 429) break; }
      assert.strictEqual(last.loginRes.status, 429); assert.strictEqual(last.loginRes.body.code, 'RATE_LIMITED'); assert(last.loginRes.headers.get('retry-after'));
    } finally { process.env.ADMIN_LOGIN_RATE_LIMIT = old; }
  });
  await t('后台账号锁定：连续 5 次失败锁 15 分钟，锁定期内正确密码也被拒；不影响其它账号', async () => {
    A.upsertAdmin('ops-lock', 'OpsPass123');
    for (let i = 0; i < 5; i++) assert.strictEqual((await adminClient('ops-lock', 'bad')).loginRes.status, 401);
    const l = await adminClient('ops-lock', 'OpsPass123'); assert.strictEqual(l.loginRes.status, 429); assert.strictEqual(l.loginRes.body.code, 'ACCOUNT_LOCKED');
    assert.strictEqual((await adminClient()).loginRes.status, 200);
  });
  await t('后台改密：旧密码校验 / 弱密码拒绝 / 成功后新密码可登录且其它会话失效', async () => {
    A.upsertAdmin('ops-pw', 'OpsPass123');
    const c1 = await adminClient('ops-pw', 'OpsPass123'), c2 = await adminClient('ops-pw', 'OpsPass123');
    assert.strictEqual((await c1.post('/api/admin/password', { oldPassword: 'bad', newPassword: 'NewPass456' })).status, 401);
    assert.strictEqual((await c1.post('/api/admin/password', { oldPassword: 'OpsPass123', newPassword: 'short' })).body.code, 'WEAK_PASSWORD');
    assert.strictEqual((await c1.post('/api/admin/password', { oldPassword: 'OpsPass123', newPassword: 'NewPass456' })).status, 200);
    assert.strictEqual((await c2.get('/api/admin/me')).status, 401); assert.strictEqual((await c1.get('/api/admin/me')).status, 200);
    assert.strictEqual((await adminClient('ops-pw', 'OpsPass123')).loginRes.status, 401); assert.strictEqual((await adminClient('ops-pw', 'NewPass456')).loginRes.status, 200);
  });
  await t('后台页面：/admin 返回 HTML（noindex），静态资源可取', async () => {
    const r = await fetch(base() + '/admin'); assert.strictEqual(r.status, 200); assert(/text\/html/.test(r.headers.get('content-type'))); assert(/noindex/.test(r.headers.get('x-robots-tag') || ''));
    const h = await r.text(); assert(h.includes('后台管理'));
    assert.strictEqual((await fetch(base() + '/admin/admin.js')).status, 200); assert.strictEqual((await fetch(base() + '/admin/admin.css')).status, 200);
  });

  // ================= 仪表盘 / 玩家 =================
  await t('仪表盘：玩家/钱包/投注/派彩/GGR 与账本一致（增量校验）', async () => {
    const d0 = (await adm.get('/api/admin/dashboard')).body;
    for (const k of ['players', 'wallet', 'totals', 'today', 'series', 'topGames', 'recent', 'games']) assert(d0[k] !== undefined, k);
    assert.strictEqual(d0.series.length, 7); assert.strictEqual(d0.games.total, config.catalog.games.length); assert.strictEqual(A.BASE.size, 186, '目录共 186 款');
    const u = await reg(uniq('dash').replace(/[^\w-]/g, ''));
    await cb(P, 'bet', { userId: u.id, txId: uniq('b'), amount: 10, roundId: 'rd1', gameId: 'slot-01', category: 'slots' });
    await cb(P, 'win', { userId: u.id, txId: uniq('w'), amount: 4, roundId: 'rd1', gameId: 'slot-01', category: 'slots' });
    const d1 = (await adm.get('/api/admin/dashboard')).body;
    assert.strictEqual(d1.players.total, d0.players.total + 1); assert.strictEqual(d1.players.newToday, d0.players.newToday + 1);
    assert.strictEqual(money(d1.totals.bets - d0.totals.bets), 10); assert.strictEqual(money(d1.totals.wins - d0.totals.wins), 4); assert.strictEqual(money(d1.totals.ggr - d0.totals.ggr), 6);
    assert.strictEqual(money(d1.wallet.total - d0.wallet.total), money(1000 - 6)); assert.strictEqual(money(d1.today.ggr - d0.today.ggr), 6);
    assert.strictEqual(d1.recent[0].type, 'win'); assert.strictEqual(d1.recent[0].username, u.username);
    // 冲正后的 bet 不计入
    const tx = uniq('b2'); await cb(P, 'bet', { userId: u.id, txId: tx, amount: 20, roundId: 'rd2', gameId: 'slot-01', category: 'slots' });
    await cb(P, 'rollback', { userId: u.id, txId: uniq('rb'), refTxId: tx });
    assert.strictEqual(money((await adm.get('/api/admin/dashboard')).body.totals.bets - d0.totals.bets), 10);
  });
  await t('玩家管理：搜索 / 筛选 / 详情(钱包+账本) / 分页', async () => {
    const n = uniq('srch').replace(/[^\w-]/g, ''); const u = await reg(n);
    const s = await adm.get('/api/admin/players?q=' + n.slice(0, 12)); assert.strictEqual(s.status, 200); assert(s.body.players.some((p) => p.id === u.id));
    const row = s.body.players.find((p) => p.id === u.id); assert.strictEqual(row.balance, 1000); assert.strictEqual(row.frozen, false); assert(!('pw' in row) && !JSON.stringify(row).includes('scrypt'));
    assert.strictEqual((await adm.get('/api/admin/players?q=zzzz-none-zzzz')).body.total, 0);
    const t01 = (await adm.get('/api/admin/players?q=test01')).body.players[0]; assert.strictEqual(t01.username, 'test01');
    const d = await adm.get('/api/admin/players/' + u.id); assert.strictEqual(d.body.player.username, n); assert(Array.isArray(d.body.ledger.rows));
    assert.strictEqual((await adm.get('/api/admin/players/u_nope')).status, 404);
    const pg = (await adm.get('/api/admin/players?limit=2&page=1')).body; assert.strictEqual(pg.players.length, 2); assert(pg.total > 2);
  });
  await t('调整演示余额：加/扣款写入账本 + 审计；缺原因/扣到负数/非法金额被拒；玩家端可见 adjust 记录', async () => {
    const u = await reg(uniq('adj').replace(/[^\w-]/g, ''));
    const a = await adm.post('/api/admin/players/' + u.id + '/adjust', { amount: 250.5, reason: '测试加款' });
    assert.strictEqual(a.status, 200); assert.strictEqual(a.body.balance, 1250.5); assert.strictEqual(a.body.tx.type, 'adjust'); assert.strictEqual(a.body.tx.reason, '测试加款');
    assert.strictEqual((await api('GET', '/api/wallet', null, u.token)).body.balance, 1250.5);
    const m = await adm.post('/api/admin/players/' + u.id + '/adjust', { amount: '-50', reason: '测试扣款' }); assert.strictEqual(m.body.balance, 1200.5);
    assert.strictEqual((await adm.post('/api/admin/players/' + u.id + '/adjust', { amount: -5000, reason: '过多' })).body.code, 'INSUFFICIENT_FUNDS');
    assert.strictEqual((await adm.post('/api/admin/players/' + u.id + '/adjust', { amount: 10 })).body.code, 'REASON_REQUIRED');
    for (const amt of [0, 'abc', 1.234, null, NaN, 1e12]) assert.strictEqual((await adm.post('/api/admin/players/' + u.id + '/adjust', { amount: amt, reason: '无效金额' })).status >= 400, true, String(amt));
    assert.strictEqual((await api('GET', '/api/wallet', null, u.token)).body.balance, 1200.5, '失败的调整不改变余额');
    const tx = await api('GET', '/api/transactions?type=adjust', null, u.token); assert.strictEqual(tx.body.transactions.length, 2);
    const d = (await adm.get('/api/admin/players/' + u.id)).body; assert.strictEqual(d.ledger.rows.filter((r) => r.type === 'adjust').length, 2); assert.strictEqual(d.ledger.rows[0].balanceAfter, 1200.5);
    const au = (await adm.get('/api/admin/audit')).body.entries; assert(au.some((e) => e.action === 'adjust_balance' && e.target === u.username && e.admin === 'admin'));
    assert.strictEqual((await adm.post('/api/admin/players/u_nope/adjust', { amount: 1, reason: 'xx' })).status, 404);
  });
  await t('冻结/解冻：已有会话立即失效、不能登录、不能充值/投注；解冻后恢复', async () => {
    const n = uniq('frz').replace(/[^\w-]/g, ''); const u = await reg(n);
    assert.strictEqual((await adm.post('/api/admin/players/' + u.id + '/freeze', { frozen: true })).body.code, 'REASON_REQUIRED');
    const f = await adm.post('/api/admin/players/' + u.id + '/freeze', { frozen: true, reason: '涉嫌刷量' }); assert.strictEqual(f.body.player.frozen, true);
    let r = await api('GET', '/api/wallet', null, u.token); assert.strictEqual(r.status, 401, '冻结后旧会话立即失效');
    r = await api('POST', '/api/auth/login', { username: n, password: 'Pass1234x' }); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'ACCOUNT_FROZEN');
    r = await cb(P, 'bet', { userId: u.id, txId: uniq('fb'), amount: 5, roundId: 'rf', gameId: 'slot-01', category: 'slots' }); assert.strictEqual(r.status >= 400, true, '冻结玩家的供应商 bet 被拒');
    assert.strictEqual(store.users.get(u.id).balance, 100000);
    assert.strictEqual((await adm.get('/api/admin/players?status=frozen')).body.players.some((p) => p.id === u.id), true);
    assert.strictEqual((await adm.post('/api/admin/players/' + u.id + '/freeze', { frozen: false })).body.player.frozen, false);
    r = await api('POST', '/api/auth/login', { username: n, password: 'Pass1234x' }); assert.strictEqual(r.status, 200);
    assert.strictEqual((await api('POST', '/api/wallet/deposit', { amount: 10 }, r.body.token)).status, 200);
  });
  await t('重置玩家密码：旧密码失效、旧会话下线', async () => {
    const n = uniq('rpw').replace(/[^\w-]/g, ''); const u = await reg(n);
    assert.strictEqual((await adm.post('/api/admin/players/' + u.id + '/password', { password: 'abc' })).body.code, 'WEAK_PASSWORD');
    assert.strictEqual((await adm.post('/api/admin/players/' + u.id + '/password', { password: 'Brand9New' })).status, 200);
    assert.strictEqual((await api('GET', '/api/wallet', null, u.token)).status, 401);
    assert.strictEqual((await api('POST', '/api/auth/login', { username: n, password: 'Pass1234x' })).status, 401);
    assert.strictEqual((await api('POST', '/api/auth/login', { username: n, password: 'Brand9New' })).status, 200);
  });

  // ================= 游戏管理 =================
  await t('游戏管理：186 款清单 / 过滤 / 启停影响前台目录与启动 / 热门·新游标记 / 排序 / 分类 / 批量 / 重置', async () => {
    const L = (await adm.get('/api/admin/games?limit=300')).body;
    assert.strictEqual(L.summary.total, config.catalog.games.length); assert.strictEqual(L.games.length, config.catalog.games.length);
    const real = config.catalog.games.filter((g) => A.BASE.has(g.id)); assert.strictEqual(real.length, 186, '186 款目录'); assert.strictEqual(config.catalog.games.length, 187, '186 + 夹具 slot-01');
    const g = real.find((x) => x.provider === 'huidu_seamless' && x.category === 'slots' && !x.tags.includes('hot') && !x.tags.includes('new'));
    assert((await adm.get('/api/admin/games?category=live&limit=300')).body.games.every((x) => x.category === 'live'));
    assert((await adm.get('/api/admin/games?q=' + encodeURIComponent(g.name.slice(0, 5)))).body.games.some((x) => x.id === g.id));
    const pub = async () => (await api('GET', '/api/games?limit=1000')).body;
    const before = (await pub()).total;
    // 下架
    let r = await adm.post('/api/admin/games/' + g.id, { enabled: false }); assert.strictEqual(r.body.game.enabled, false);
    let p = await pub(); assert.strictEqual(p.total, before - 1); assert(!p.games.some((x) => x.id === g.id));
    const u = await reg(uniq('gm').replace(/[^\w-]/g, ''));
    assert.strictEqual((await api('POST', '/api/games/' + g.id + '/launch', {}, u.token)).status, 404);
    assert.strictEqual((await api('GET', '/api/games/' + g.id)).status, 404);
    assert.strictEqual((await adm.get('/api/admin/games?enabled=0&limit=300')).body.games.some((x) => x.id === g.id), true);
    // 上架 + 热门/新游
    r = await adm.post('/api/admin/games/' + g.id, { enabled: true, hot: true, isNew: true }); assert(r.body.game.hot && r.body.game.isNew);
    p = await pub(); const pg = p.games.find((x) => x.id === g.id); assert(pg.tags.includes('hot') && pg.tags.includes('new')); assert.strictEqual(p.total, before);
    assert(!('enabled' in pg) && !('sort' in pg), '内部字段不外泄');
    assert((await api('GET', '/api/games?tag=new')).body.games.some((x) => x.id === g.id));
    assert((await adm.get('/api/admin/games?flag=hot&limit=300')).body.games.some((x) => x.id === g.id));
    // 排序：置顶
    await adm.post('/api/admin/games/' + g.id, { sort: -5 }); assert.strictEqual((await pub()).games[0].id, g.id);
    // 分类
    assert.strictEqual((await adm.post('/api/admin/games/' + g.id, { category: 'nope' })).body.code, 'INVALID_CATEGORY');
    assert.strictEqual((await adm.post('/api/admin/games/' + g.id, { sort: 'abc' })).body.code, 'INVALID_SORT');
    await adm.post('/api/admin/games/' + g.id, { category: 'table' }); assert.strictEqual((await api('GET', '/api/games/' + g.id)).body.game.category, 'table');
    assert.strictEqual((await adm.get('/api/admin/games?category=table&limit=300')).body.games.find((x) => x.id === g.id).baseCategory, 'slots');
    // 批量
    const ids = real.slice(0, 3).map((x) => x.id);
    assert.strictEqual((await adm.post('/api/admin/games/bulk', { ids, enabled: false })).body.updated, 3); assert.strictEqual((await pub()).total, before - 3);
    assert.strictEqual((await adm.post('/api/admin/games/bulk', { ids: [] })).status, 400);
    // 重置全部
    await adm.post('/api/admin/games/bulk', { ids: ids.concat(g.id), reset: true });
    p = await pub(); assert.strictEqual(p.total, before); const back = p.games.find((x) => x.id === g.id);
    assert.strictEqual(back.category, 'slots'); assert(!back.tags.includes('hot') && !back.tags.includes('new'));
    assert.strictEqual((await adm.post('/api/admin/games/nope-nope', { enabled: false })).status, 404);
  });

  // ================= 供应商 =================
  await t('供应商状态：模式/钱包模式/游戏数/活动；绝不泄露 apiKey / secret / 代理 UID', async () => {
    const r = await adm.get('/api/admin/providers'); assert.strictEqual(r.status, 200);
    const hd = r.body.providers.find((x) => x.id === 'huidu_seamless'); assert.strictEqual(hd.mode, 'simulator'); assert.strictEqual(hd.walletMode, 'shared'); assert(hd.games.total >= 100);
    assert.strictEqual(r.body.providers.find((x) => x.id === 'demo_slot_a').mode, 'mock'); assert.strictEqual(r.body.providers.find((x) => x.id === 'your_real_provider').enabled, false);
    const txt = JSON.stringify(r.body);
    for (const [id, p] of Object.entries(config.providers)) for (const v of [p.apiKey, p.secret]) if (v && v.length >= 6) assert(!txt.includes(v), `${id} 的凭据不应出现在响应中`);
    assert.strictEqual(typeof hd.credentials.secret, 'boolean');
  });

  // ================= 交易查询 =================
  await t('交易查看器：类型/玩家/游戏/供应商/状态/日期/金额/关键字 过滤 + 分页 + 汇总', async () => {
    const u = await reg(uniq('txv').replace(/[^\w-]/g, '')); const T = (q) => adm.get('/api/admin/transactions?' + q).then((x) => x.body);
    const b1 = uniq('vb'), w1 = uniq('vw');
    await cb(P, 'bet', { userId: u.id, txId: b1, amount: 30, roundId: 'rv1', gameId: 'slot-01', category: 'slots' });
    await cb(P, 'win', { userId: u.id, txId: w1, amount: 12, roundId: 'rv1', gameId: 'slot-01', category: 'slots' });
    await adm.post('/api/admin/players/' + u.id + '/adjust', { amount: 5, reason: '交易过滤' });
    const all = await T('player=' + u.username); assert.strictEqual(all.total, 3); assert.strictEqual(all.transactions[0].type, 'adjust', '默认按时间倒序');
    assert.deepStrictEqual({ b: all.summary.bets, w: all.summary.wins, g: all.summary.ggr }, { b: 30, w: 12, g: 18 });
    assert.strictEqual((await T('player=' + u.username + '&type=bet')).total, 1);
    assert.strictEqual((await T('player=' + u.username + '&type=bet')).transactions[0].amount, 30);
    assert.strictEqual((await T('player=' + u.username + '&provider=' + P)).total, 2);
    assert.strictEqual((await T('player=' + u.username + '&provider=admin')).total, 1);
    assert.strictEqual((await T('player=' + u.username + '&game=slot-01')).total, 2);
    assert.strictEqual((await T('player=' + u.username + '&game=' + encodeURIComponent('测试老虎'))).total, 2);
    assert.strictEqual((await T('player=' + u.username + '&q=' + b1)).total, 1);
    assert.strictEqual((await T('player=' + u.username + '&min=20')).total, 1);
    assert.strictEqual((await T('player=' + u.username + '&min=10&max=15')).total, 1);
    assert.strictEqual((await T('player=' + u.username + '&status=ok')).total, 3);
    const day = new Date(Date.now() + 480 * 60000).toISOString().slice(0, 10), yday = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
    assert.strictEqual((await T('player=' + u.username + '&from=' + day + '&to=' + day)).total, 3);
    assert.strictEqual((await T('player=' + u.username + '&from=' + yday + '&to=' + yday)).total, 0);
    assert.strictEqual((await T('player=' + u.username + '&from=' + (Date.now() + 60000))).total, 0);
    const pg = await T('player=' + u.username + '&limit=2&page=2'); assert.strictEqual(pg.transactions.length, 1); assert.strictEqual(pg.total, 3);
    assert.strictEqual((await T('player=no-such-player-xyz')).total, 0);
    assert(all.types.includes('adjust') && all.providers.some((x) => x.id === 'admin'));
    await cb(P, 'rollback', { userId: u.id, txId: uniq('vr'), refTxId: b1 });
    assert.strictEqual((await T('player=' + u.username + '&status=rolled_back')).total, 1);
  });

  // ================= 设置 =================
  await t('设置：维护横幅(公开 /api/config 可见) / 维护模式禁止启动游戏 / 关闭注册 / 校验与恢复', async () => {
    assert.strictEqual((await api('GET', '/api/config')).body.maintenance.enabled, false);
    assert.strictEqual((await adm.post('/api/admin/settings', { maintenance: { enabled: true, text: '  ' } })).body.code, 'TEXT_REQUIRED');
    const r = await adm.post('/api/admin/settings', { maintenance: { enabled: true, text: '今晚 02:00 例行维护', level: 'warn' } }); assert.strictEqual(r.status, 200);
    let c = (await api('GET', '/api/config')).body; assert.deepStrictEqual({ e: c.maintenance.enabled, t: c.maintenance.text, l: c.maintenance.level, b: c.maintenance.blockPlay }, { e: true, t: '今晚 02:00 例行维护', l: 'warn', b: false });
    const u = await reg(uniq('mt').replace(/[^\w-]/g, '')); const inh = config.catalog.games.find((g) => g.type === 'inhouse');
    assert.strictEqual((await api('POST', '/api/games/' + inh.id + '/launch', {}, u.token)).status, 200, '仅横幅时仍可玩');
    await adm.post('/api/admin/settings', { blockPlay: true });
    const l = await api('POST', '/api/games/' + inh.id + '/launch', {}, u.token); assert.strictEqual(l.status, 503); assert.strictEqual(l.body.code, 'MAINTENANCE');
    assert.strictEqual((await api('GET', '/api/config')).body.maintenance.blockPlay, true);
    await adm.post('/api/admin/settings', { registrationOpen: false });
    assert.strictEqual((await api('POST', '/api/auth/register', { username: uniq('cl').replace(/[^\w-]/g, ''), password: 'Pass1234x' })).body.code, 'REGISTRATION_CLOSED');
    assert.strictEqual((await api('POST', '/api/auth/login', { username: 'test01', password: 'Test@2026' })).status, 200, '关闭注册不影响登录');
    await adm.post('/api/admin/settings', { maintenance: { enabled: false }, blockPlay: false, registrationOpen: true });
    c = (await api('GET', '/api/config')).body; assert.strictEqual(c.maintenance.enabled, false); assert.strictEqual(c.maintenance.blockPlay, false);
    assert.strictEqual((await api('POST', '/api/games/' + inh.id + '/launch', {}, u.token)).status, 200);
    const s = (await adm.get('/api/admin/settings')).body; assert.strictEqual(s.settings.registrationOpen, true); assert.strictEqual(typeof s.system.persistence, 'boolean');
    assert(!JSON.stringify(s).match(/secret|apiKey/i));
  });

  // ================= 持久化 / 重启 / 环境变量覆盖 =================
  const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  async function startChild(env) {
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], { env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', LOGIN_RATE_LIMIT_PER_MIN: '100000', ADMIN_LOGIN_RATE_LIMIT: '100000' }, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) break; } catch { /* 等待启动 */ } await sleep(100); if (child.exitCode != null) throw new Error('子进程退出: ' + out); }
    const stop = () => new Promise((res) => { child.once('exit', res); child.kill('SIGTERM'); });
    const call = async (m, p, body, h) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: body ? JSON.stringify(body) : undefined }); return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) }; };
    const admin = async (u, pw) => { const l = await call('POST', '/api/admin/login', { username: u, password: pw }); if (l.status !== 200) return { loginRes: l }; const ck = l.headers.get('set-cookie').split(';')[0]; return { loginRes: l, get: (p) => call('GET', p, null, { Cookie: ck }), post: (p, b) => call('POST', p, b || {}, { Cookie: ck, 'X-CSRF-Token': l.body.csrf }) }; };
    return { port, call, admin, stop, out: () => out };
  }
  await t('持久化：重启后保留 玩家/密码/余额/账本/游戏运营设置/维护横幅/审计；退出时无残留临时文件', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8k-persist-')); const env = { DATA_DIR: dir, PERSIST_DELAY_MS: '50', SCRYPT_N: '1024' };
    let s = await startChild(env);
    const name = 'persist' + Date.now();
    const rg = await s.call('POST', '/api/auth/register', { username: name, password: 'Persist123' }); assert.strictEqual(rg.status, 200);
    const ad = await s.admin('admin', 'Admin@2026!'); assert.strictEqual(ad.loginRes.status, 200);
    assert.strictEqual((await ad.post(`/api/admin/players/${rg.body.user.id}/adjust`, { amount: 123.45, reason: '持久化测试' })).body.balance, 1123.45);
    const gid = config.catalog.games.find((g) => g.provider === 'huidu_seamless').id;
    await ad.post('/api/admin/games/' + gid, { enabled: false, hot: true, sort: -9 });
    await ad.post('/api/admin/settings', { maintenance: { enabled: true, text: '重启测试公告' } });
    await sleep(300); await s.stop();
    const files = fs.readdirSync(dir).sort(); assert.deepStrictEqual(files, ['admin.json', 'ledger.json', 'users.json'], files.join(','));
    assert(!fs.readFileSync(path.join(dir, 'users.json'), 'utf8').includes('Persist123'), '磁盘上无明文密码');
    s = await startChild(env);
    const lg = await s.call('POST', '/api/auth/login', { username: name, password: 'Persist123' }); assert.strictEqual(lg.status, 200); assert.strictEqual(lg.body.wallet.balance, 1123.45);
    assert.strictEqual((await s.call('GET', '/api/transactions?type=adjust', null, { Authorization: 'Bearer ' + lg.body.token })).body.transactions.length, 1);
    const ad2 = await s.admin('admin', 'Admin@2026!'); assert.strictEqual(ad2.loginRes.status, 200);
    const gl = (await ad2.get('/api/admin/games?limit=300')).body.games.find((g) => g.id === gid); assert.deepStrictEqual({ e: gl.enabled, h: gl.hot, s: gl.sort }, { e: false, h: true, s: -9 });
    assert.strictEqual((await s.call('GET', '/api/config')).body.maintenance.text, '重启测试公告');
    assert((await ad2.get('/api/admin/audit')).body.entries.some((e) => e.action === 'adjust_balance'));
    assert.strictEqual((await s.call('POST', '/api/auth/login', { username: 'test01', password: 'Test@2026' })).body.wallet.balance, 10000);
    // 玩家 token 不跨重启(会话仅内存)
    assert.strictEqual((await s.call('GET', '/api/wallet', null, { Authorization: 'Bearer ' + rg.body.token })).status, 401);
    await s.stop();
    // 损坏的数据文件：改名保留并以默认值启动，不致命
    fs.writeFileSync(path.join(dir, 'ledger.json'), '{"entries":[{"broken'); s = await startChild(env);
    assert.strictEqual((await s.call('POST', '/api/auth/login', { username: name, password: 'Persist123' })).status, 200);
    assert(fs.readdirSync(dir).some((f) => f.startsWith('ledger.json.corrupt-'))); await s.stop();
  });
  await t('环境变量覆盖：ADMIN_USERNAME/ADMIN_PASSWORD、DEMO_PLAYER_PASSWORD/DEMO_PLAYERS/DEMO_PLAYER_BALANCE、SEED_DEMO=0；DATA_DIR=off 不落盘', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8k-env-'));
    let s = await startChild({ DATA_DIR: dir, SCRYPT_N: '1024', ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'Boss#Pass2026', DEMO_PLAYER_PASSWORD: 'Custom#Pw2026', DEMO_PLAYERS: 'alice1,bob22', DEMO_PLAYER_BALANCE: '777' });
    assert.strictEqual((await s.admin('boss', 'Boss#Pass2026')).loginRes.status, 200); assert.strictEqual((await s.admin('admin', 'Admin@2026!')).loginRes.status, 401, '设置了 ADMIN_* 后不再创建默认 admin');
    const l = await s.call('POST', '/api/auth/login', { username: 'alice1', password: 'Custom#Pw2026' }); assert.strictEqual(l.status, 200); assert.strictEqual(l.body.wallet.balance, 777);
    assert.strictEqual((await s.call('POST', '/api/auth/login', { username: 'test01', password: 'Test@2026' })).status, 401); await s.stop();
    s = await startChild({ DATA_DIR: 'off', SCRYPT_N: '1024', SEED_DEMO: '0', PERSIST_DELAY_MS: '10' });
    assert.strictEqual((await s.call('POST', '/api/auth/login', { username: 'test01', password: 'Test@2026' })).status, 401, 'SEED_DEMO=0 不创建演示玩家');
    assert.strictEqual((await s.admin('admin', 'Admin@2026!')).loginRes.status, 200);
    await s.call('POST', '/api/auth/register', { username: 'offmode1', password: 'Pass1234x' }); await sleep(100); await s.stop();
  });
};
