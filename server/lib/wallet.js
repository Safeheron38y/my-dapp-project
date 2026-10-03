'use strict';
/**
 * 钱包核心：共享钱包(Seamless) 的 bet / win / rollback / refund，以及 转账钱包(Transfer) 的转入转出。
 *
 * 幂等规则（详见 API.md）：
 *  1. 幂等键 = (provider, txId)。同一键重复请求且载荷一致 → 返回首次结果(duplicate:true)，不再改变余额。
 *  2. 同一键但载荷(金额/玩家/类型)不一致 → IDEMPOTENCY_CONFLICT，不改变余额。
 *  3. 一笔 bet 或 win 最多只能被冲正一次（rollback 或 refund 二选一）；用不同 txId 再次冲正同一笔 → 视为成功但不再动账(alreadyReversed:true)。
 *  4. 冲正先于原交易到达(乱序)：写入“墓碑”，之后到达的原 bet 会被拒绝(TX_CANCELLED)，不扣款。
 *  5. 轮次已有被冲正的 bet 时，该轮的 win 被拒绝(ROUND_CANCELLED)。
 *  6. 所有金额为整数“分”，余额不允许为负(bet 余额不足 → INSUFFICIENT_FUNDS)。
 * 注意：Node 单线程下此处的同步代码天然串行；换成数据库时必须用事务 + 行锁 + 唯一索引达到同等效果。
 */
const store = require('./store');
const geo = require('./geo');
const rg = require('./rg');
const config = require('./config');
const crypto = require('crypto');

class WalletError extends Error {
  constructor(code, message, http = 400, extra) { super(message || code); this.code = code; this.http = http; this.extra = extra; }
}
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 24);
const key = (p, t) => `${p}:${t}`;

function getUser(userId) {
  const u = store.users.get(userId);
  if (!u) throw new WalletError('PLAYER_NOT_FOUND', '玩家不存在', 404);
  return u;
}
function needTx(txId) {
  if (typeof txId !== 'string' || !/^[\w.:\-]{1,100}$/.test(txId)) throw new WalletError('INVALID_TX_ID', 'txId 必填，1-100 位字母数字或 . : _ -', 400);
}
function view(e, u, extra) {
  return Object.assign({ txId: e.txId, type: e.type, amount: e.amount / 100, balance: u.balance / 100, currency: config.regions.currency.code, roundId: e.roundId || null, createdAt: e.createdAt }, extra || {});
}
function prior(provider, txId, h) {
  const ex = store.ledger.get(key(provider, txId));
  if (!ex) return null;
  if (ex.type === 'cancelled') throw new WalletError('TX_CANCELLED', '该交易已被冲正(先到冲正)，不会入账', 409);
  if (ex.reqHash !== h) throw new WalletError('IDEMPOTENCY_CONFLICT', 'txId 已被使用且请求内容不同', 409);
  return ex;
}
function push(e, u) {
  e.createdAt = Date.now(); e.balanceAfter = u.balance;
  store.addEntry(e);
  return e;
}

function balance(userId) { const u = getUser(userId); return { balance: u.balance / 100, currency: config.regions.currency.code }; }

function bet({ provider, userId, txId, amountMinor, roundId, gameId, category, meta }) {
  needTx(txId);
  const u = getUser(userId);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new WalletError('INVALID_AMOUNT', '金额必须大于 0 且最多两位小数');
  const h = hash(['bet', userId, amountMinor, roundId || null, gameId || null]);
  const ex = prior(provider, txId, h);
  if (ex) {
    if (ex.type === 'cancelled') throw new WalletError('TX_CANCELLED', '该交易已被冲正(先到冲正)', 409);
    return { duplicate: true, entry: ex, user: u, view: view(ex, u, { duplicate: true, status: ex.status }) };
  }
  if (category && !geo.categoryEnabled(u.region, category)) throw new WalletError('CATEGORY_DISABLED', '您所在地区暂未开放该品类', 403);
  const lim = geo.limitsFor(u.region, category);
  if (lim.minBet != null && amountMinor < Math.round(lim.minBet * 100)) throw new WalletError('BELOW_MIN_BET', `最低投注 ${lim.minBet}`, 400, { minBet: lim.minBet });
  if (lim.maxBet != null && amountMinor > Math.round(lim.maxBet * 100)) throw new WalletError('ABOVE_MAX_BET', `单笔最高投注 ${lim.maxBet}`, 400, { maxBet: lim.maxBet });
  const block = rg.beforeBet(userId, amountMinor, { provider, gameId, category });
  if (block) throw new WalletError(block.code, block.message, 403);
  if (roundId) {
    for (const e of store.ledgerOf(userId)) if (e.roundId === roundId && e.provider === provider && e.status === 'rolled_back' && e.type === 'bet') throw new WalletError('ROUND_CANCELLED', '该轮次已取消', 409);
  }
  if (u.balance < amountMinor) throw new WalletError('INSUFFICIENT_FUNDS', '余额不足', 402, { balance: u.balance / 100 });
  u.balance -= amountMinor;
  const e = push({ txId, provider, userId, type: 'bet', amount: amountMinor, roundId, gameId, category, status: 'ok', reqHash: h, meta }, u);
  return { duplicate: false, entry: e, user: u, view: view(e, u, { status: 'ok' }) };
}

function win({ provider, userId, txId, amountMinor, roundId, gameId, category, refTxId, meta }) {
  needTx(txId);
  const u = getUser(userId);
  if (!Number.isInteger(amountMinor) || amountMinor < 0) throw new WalletError('INVALID_AMOUNT', '金额必须 >= 0 且最多两位小数');
  const h = hash(['win', userId, amountMinor, roundId || null, gameId || null]);
  const ex = prior(provider, txId, h);
  if (ex) return { duplicate: true, entry: ex, user: u, view: view(ex, u, { duplicate: true, status: ex.status }) };
  if (roundId) {
    for (const e of store.ledgerOf(userId)) if (e.roundId === roundId && e.provider === provider && e.type === 'bet' && e.status === 'rolled_back') throw new WalletError('ROUND_CANCELLED', '该轮次投注已被冲正，不能派彩', 409);
  }
  u.balance += amountMinor;
  const e = push({ txId, provider, userId, type: 'win', amount: amountMinor, roundId, gameId, category, status: 'ok', reqHash: h, refTxId, meta }, u);
  return { duplicate: false, entry: e, user: u, view: view(e, u, { status: 'ok' }) };
}


/**
 * settle：一条账本同时记录 投注 + 派彩（HUIDU 回调语义：bet_amount 与 win_amount 在同一条回调里）。
 *  - betMinor / winMinor 均为整数“分”，可为 0（免费旋转 bet=0、输局 win=0）；
 *  - 负数 = 退款/追扣（HUIDU：“金额负值时为退款”，且无原交易引用）：bet<0 → 退还投注，win<0 → 追扣派彩。
 *  - 净变动 delta = win - bet（与 HUIDU “credit_amount = 余额 - bet + win” 一致）；余额 + delta < 0 → INSUFFICIENT_FUNDS，不入账；
 *  - 幂等键 (provider, txId)（HUIDU 的 serial_number）：重复 → duplicate:true，返回最新余额；同键不同载荷 → IDEMPOTENCY_CONFLICT；
 *  - 仅当 bet>0 时才套用品类开关 / 限额 / 负责任博彩检查（退款与派彩永远允许）。
 */
function settle({ provider, userId, txId, betMinor, winMinor, roundId, gameId, category, meta }) {
  needTx(txId);
  const u = getUser(userId);
  if (!Number.isSafeInteger(betMinor) || !Number.isSafeInteger(winMinor)) throw new WalletError('INVALID_AMOUNT', '金额必须是整数分（最多两位小数）');
  const h = hash(['settle', userId, betMinor, winMinor, roundId || null, gameId || null]);
  const ex = prior(provider, txId, h);
  const sv = (e, extra) => view(e, u, Object.assign({ bet: e.bet / 100, win: e.win / 100, status: e.status }, extra));
  if (ex) return { duplicate: true, entry: ex, user: u, view: sv(ex, { duplicate: true }) };
  const delta = winMinor - betMinor;
  if (betMinor > 0) {
    if (category && !geo.categoryEnabled(u.region, category)) throw new WalletError('CATEGORY_DISABLED', '该品类暂未开放', 403);
    const lim = geo.limitsFor(u.region, category);
    if (lim.minBet != null && betMinor < Math.round(lim.minBet * 100)) throw new WalletError('BELOW_MIN_BET', `最低投注 ${lim.minBet}`, 400, { minBet: lim.minBet });
    if (lim.maxBet != null && betMinor > Math.round(lim.maxBet * 100)) throw new WalletError('ABOVE_MAX_BET', `单笔最高投注 ${lim.maxBet}`, 400, { maxBet: lim.maxBet });
    const block = rg.beforeBet(userId, betMinor, { provider, gameId, category });
    if (block) throw new WalletError(block.code, block.message, 403);
  }
  if (u.balance + delta < 0) throw new WalletError('INSUFFICIENT_FUNDS', '余额不足', 402, { balance: u.balance / 100 });
  u.balance += delta;
  const e = push({ txId, provider, userId, type: 'settle', amount: delta, bet: betMinor, win: winMinor, roundId, gameId, category, status: 'ok', reqHash: h, meta }, u);
  return { duplicate: false, entry: e, user: u, view: sv(e) };
}

// kind: 'rollback'(技术性冲正：超时/失败) | 'refund'(业务性退款：作废/取消)
function reverse(kind, { provider, userId, txId, refTxId }) {
  needTx(txId); needTx(refTxId);
  const u = getUser(userId);
  const h = hash([kind, userId, refTxId]);
  const ex = prior(provider, txId, h);
  if (ex) return { duplicate: true, entry: ex, user: u, view: view(ex, u, { duplicate: true, status: ex.status, refTxId }) };
  const ref = store.ledger.get(key(provider, refTxId));
  if (!ref) {
    // 乱序：先收到冲正。写“墓碑”，并占用原交易 ID，之后原 bet 会被拒绝。
    const tomb = { txId: refTxId, provider, userId, type: 'cancelled', amount: 0, status: 'cancelled', reqHash: '*tombstone*', createdAt: Date.now() };
    store.addEntry(tomb);
    const e = push({ txId, provider, userId, type: kind, amount: 0, status: 'ok', reqHash: h, refTxId, note: 'ref_not_found_tombstoned' }, u);
    return { duplicate: false, entry: e, user: u, view: view(e, u, { status: 'ok', refTxId, refFound: false }) };
  }
  if (ref.userId !== userId) throw new WalletError('PLAYER_MISMATCH', '原交易不属于该玩家', 409);
  if (ref.type !== 'bet' && ref.type !== 'win') throw new WalletError('NOT_REVERSIBLE', '该类型交易不可冲正', 409);
  if (kind === 'refund' && ref.type !== 'bet') throw new WalletError('NOT_REVERSIBLE', 'refund 仅用于 bet；win 请使用 rollback', 409);
  if (ref.status === 'rolled_back') {
    const e = push({ txId, provider, userId, type: kind, amount: 0, status: 'ok', reqHash: h, refTxId, note: 'already_reversed' }, u);
    return { duplicate: false, entry: e, user: u, view: view(e, u, { status: 'ok', refTxId, alreadyReversed: true }) };
  }
  let delta;
  if (ref.type === 'bet') { delta = ref.amount; u.balance += delta; }
  else {
    if (u.balance < ref.amount) throw new WalletError('INSUFFICIENT_FUNDS', '余额不足以冲正派彩，需人工处理', 402);
    delta = ref.amount; u.balance -= delta;
  }
  ref.status = 'rolled_back';
  const e = push({ txId, provider, userId, type: kind, amount: delta, status: 'ok', reqHash: h, refTxId, roundId: ref.roundId, gameId: ref.gameId, category: ref.category, reversed: ref.type }, u);
  return { duplicate: false, entry: e, user: u, view: view(e, u, { status: 'ok', refTxId, refFound: true }) };
}
const rollback = (a) => reverse('rollback', a);
const refund = (a) => reverse('refund', a);

// 站内充值(演示)：真实环境由支付通道回调触发
function deposit({ userId, amountMinor, txId }) {
  needTx(txId);
  const u = getUser(userId);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new WalletError('INVALID_AMOUNT', '金额必须大于 0 且最多两位小数');
  const h = hash(['deposit', userId, amountMinor]);
  const ex = prior('platform', txId, h);
  if (ex) return { duplicate: true, view: view(ex, u, { duplicate: true }) };
  const lim = geo.limitsFor(u.region);
  if (lim.minDeposit != null && amountMinor < Math.round(lim.minDeposit * 100)) throw new WalletError('BELOW_MIN_DEPOSIT', `最低充值 ${lim.minDeposit}`, 400);
  if (lim.maxDeposit != null && amountMinor > Math.round(lim.maxDeposit * 100)) throw new WalletError('ABOVE_MAX_DEPOSIT', `单笔最高充值 ${lim.maxDeposit}`, 400);
  if (lim.maxDailyDeposit != null) {
    const since = Date.now() - 86400000; let sum = 0;
    for (const e of store.ledgerOf(userId)) if (e.type === 'deposit' && e.createdAt >= since) sum += e.amount;
    if (sum + amountMinor > Math.round(lim.maxDailyDeposit * 100)) throw new WalletError('ABOVE_DAILY_DEPOSIT', `超过每日充值限额 ${lim.maxDailyDeposit}`, 400);
  }
  const block = rg.beforeDeposit(userId, amountMinor);
  if (block) throw new WalletError(block.code, block.message, 403);
  u.balance += amountMinor;
  const e = push({ txId, provider: 'platform', userId, type: 'deposit', amount: amountMinor, status: 'ok', reqHash: h, meta: { demo: true } }, u);
  return { duplicate: false, view: view(e, u, { status: 'ok' }) };
}

// ---- 转账钱包(Transfer Wallet)：平台余额 <-> 供应商余额 ----
const providerBal = new Map(); // `${provider}:${userId}` -> minor
const pbKey = (p, u) => `${p}:${u}`;
function providerBalance(provider, userId) { return providerBal.get(pbKey(provider, userId)) || 0; }
// external:true = 供应商侧余额由供应商自己维护(如 HUIDU 转账钱包)：转出不再用本地镜像校验，镜像只作参考(下限 0)。
function transfer({ provider, userId, direction, amountMinor, txId, external }) {
  needTx(txId);
  const u = getUser(userId);
  if (direction !== 'in' && direction !== 'out') throw new WalletError('INVALID_DIRECTION', 'direction 必须是 in 或 out');
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new WalletError('INVALID_AMOUNT', '金额必须大于 0 且最多两位小数');
  const h = hash(['transfer', userId, direction, amountMinor]);
  const ex = prior(provider, txId, h);
  const out = (e) => ({ txId, direction, amount: e.amount / 100, balance: u.balance / 100, providerBalance: providerBalance(provider, userId) / 100, currency: config.regions.currency.code });
  if (ex) return Object.assign(out(ex), { duplicate: true });
  if (direction === 'in') {
    if (u.balance < amountMinor) throw new WalletError('INSUFFICIENT_FUNDS', '余额不足', 402);
    u.balance -= amountMinor; providerBal.set(pbKey(provider, userId), providerBalance(provider, userId) + amountMinor);
  } else {
    if (!external && providerBalance(provider, userId) < amountMinor) throw new WalletError('INSUFFICIENT_FUNDS', '供应商钱包余额不足', 402);
    providerBal.set(pbKey(provider, userId), Math.max(0, providerBalance(provider, userId) - amountMinor)); u.balance += amountMinor;
  }
  const e = push({ txId, provider, userId, type: direction === 'in' ? 'transfer_in' : 'transfer_out', amount: amountMinor, status: 'ok', reqHash: h }, u);
  return Object.assign(out(e), { duplicate: false });
}
// 供转账钱包的 mock 供应商内部下注使用
function providerAdjust(provider, userId, deltaMinor) {
  const cur = providerBalance(provider, userId);
  if (cur + deltaMinor < 0) throw new WalletError('INSUFFICIENT_FUNDS', '供应商钱包余额不足', 402);
  providerBal.set(pbKey(provider, userId), cur + deltaMinor);
  return (cur + deltaMinor) / 100;
}

module.exports = { WalletError, balance, bet, settle, win, rollback, refund, deposit, transfer, providerBalance, providerAdjust };
