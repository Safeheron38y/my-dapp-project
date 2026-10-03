'use strict';
/**
 * 自研演示小游戏服务端 (Crash / Plinko / Mines)。
 * ⚠ 仅为演示：使用 crypto.randomInt 的 mock RNG，没有 provably-fair 承诺，也未经任何认证机构审核。
 * 真实上线需替换为经认证的 RNG / 供应商，并由合规确认。
 * 余额变更全部走 wallet.bet / wallet.win（provider = "inhouse"），与第三方游戏同一套账。
 */
const crypto = require('crypto');
const wallet = require('./wallet');
const store = require('./store');
const { WalletError } = wallet;

const rounds = new Map(); // roundId -> round
const PROV = 'inhouse';
const RTP = 0.97; // 演示用理论返还率参数
const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const rid = () => 'r_' + crypto.randomBytes(6).toString('hex');
const m2 = (x) => Math.floor(x * 100) / 100;

function active(userId, game) { for (const r of rounds.values()) if (r.userId === userId && r.game === game && r.state === 'open') return r; return null; }
function getRound(userId, roundId, game) {
  const r = rounds.get(roundId);
  if (!r || r.userId !== userId || r.game !== game) throw new WalletError('ROUND_NOT_FOUND', '轮次不存在', 404);
  return r;
}
function settle(r, payoutMinor, userId) {
  r.state = 'done';
  let balance;
  if (payoutMinor > 0) balance = wallet.win({ provider: PROV, userId, txId: r.id + ':win', amountMinor: payoutMinor, roundId: r.id, gameId: r.game, category: 'crash' }).view.balance;
  else balance = wallet.balance(userId).balance;
  r.payout = payoutMinor; return balance;
}

// ---------- Crash ----------
// crashPoint = max(1, floor(RTP/(1-u)*100)/100)，演示公式
const GROWTH = 0.00006; // mult(t)=exp(GROWTH*t_ms)
const crashMult = (ms) => m2(Math.exp(GROWTH * ms));
function crashStart(userId, amount) {
  if (active(userId, 'crash')) throw new WalletError('ROUND_ACTIVE', '已有进行中的回合', 409);
  const id = rid();
  const u = rnd();
  const point = Math.max(1, Math.min(1000, m2(RTP / (1 - u))));
  const b = wallet.bet({ provider: PROV, userId, txId: id + ':bet', amountMinor: amount, roundId: id, gameId: 'crash', category: 'crash' });
  const startAt = Date.now() + 1500; // 1.5s 倒计时后起飞
  rounds.set(id, { id, userId, game: 'crash', state: 'open', bet: amount, point, startAt });
  return { roundId: id, startAt, serverNow: Date.now(), growth: GROWTH, balance: b.view.balance, demo: true };
}
function crashCash(userId, roundId) {
  const r = getRound(userId, roundId, 'crash');
  if (r.state !== 'open') throw new WalletError('ROUND_CLOSED', '回合已结束', 409);
  const ms = Date.now() - r.startAt;
  const mult = ms < 0 ? 1 : crashMult(ms);
  if (mult >= r.point) { r.state = 'done'; r.payout = 0; return { result: 'crashed', crashPoint: r.point, balance: wallet.balance(userId).balance, payout: 0 }; }
  const payout = Math.floor(r.bet * mult);
  const balance = settle(r, payout, userId);
  return { result: 'cashed', multiplier: mult, payout: payout / 100, balance, crashPoint: null };
}
// 前端轮询：回合是否已崩盘（崩盘点只在崩盘后揭示）
function crashPoll(userId, roundId) {
  const r = getRound(userId, roundId, 'crash');
  if (r.state === 'open') {
    const ms = Date.now() - r.startAt;
    if (ms >= 0 && crashMult(ms) >= r.point) { r.state = 'done'; r.payout = 0; }
  }
  if (r.state === 'open') return { state: 'open', serverNow: Date.now(), startAt: r.startAt };
  return { state: 'done', crashPoint: r.point, payout: (r.payout || 0) / 100, balance: wallet.balance(userId).balance };
}

// ---------- Plinko ----------
const PLINKO = {
  low:  { 8: [5.6, 2.1, 1.1, 1, .5, 1, 1.1, 2.1, 5.6], 12: [8.4, 3, 1.6, 1.4, 1.1, 1, .5, 1, 1.1, 1.4, 1.6, 3, 8.4], 16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, .5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16] },
  med:  { 8: [13, 3, 1.3, .7, .4, .7, 1.3, 3, 13], 12: [33, 11, 4, 2, 1.1, .6, .3, .6, 1.1, 2, 4, 11, 33], 16: [110, 41, 10, 5, 3, 1.5, 1, .5, .3, .5, 1, 1.5, 3, 5, 10, 41, 110] },
  high: { 8: [29, 4, 1.5, .3, .2, .3, 1.5, 4, 29], 12: [170, 24, 8.1, 2, .7, .2, .2, .2, .7, 2, 8.1, 24, 170], 16: [1000, 130, 26, 9, 4, 2, .2, .2, .2, .2, .2, 2, 4, 9, 26, 130, 1000] },
};
function plinkoTable() { return PLINKO; }
function plinkoDrop(userId, amount, rows, risk) {
  rows = Number(rows); risk = String(risk);
  if (!PLINKO[risk] || !PLINKO[risk][rows]) throw new WalletError('INVALID_PARAMS', 'rows 取 8/12/16，risk 取 low/med/high');
  const id = rid();
  wallet.bet({ provider: PROV, userId, txId: id + ':bet', amountMinor: amount, roundId: id, gameId: 'plinko', category: 'crash' });
  const path = []; let k = 0;
  for (let i = 0; i < rows; i++) { const d = rnd() < 0.5 ? 0 : 1; path.push(d); k += d; }
  const mult = PLINKO[risk][rows][k];
  const r = { id, userId, game: 'plinko', state: 'open', bet: amount };
  rounds.set(id, r);
  const payout = Math.floor(amount * mult);
  const balance = settle(r, payout, userId);
  return { roundId: id, path, slot: k, multiplier: mult, payout: payout / 100, balance, demo: true };
}

// ---------- Mines (5x5) ----------
function minesMult(mines, safe) { // 演示公式：RTP * C(25,k)/C(25-m,k)
  let p = 1; for (let i = 0; i < safe; i++) p *= (25 - mines - i) / (25 - i);
  return safe === 0 ? 1 : m2(RTP / p);
}
function minesStart(userId, amount, mines) {
  mines = Number(mines);
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) throw new WalletError('INVALID_PARAMS', 'mines 取 1-24');
  if (active(userId, 'mines')) throw new WalletError('ROUND_ACTIVE', '已有进行中的回合', 409);
  const id = rid();
  const b = wallet.bet({ provider: PROV, userId, txId: id + ':bet', amountMinor: amount, roundId: id, gameId: 'mines', category: 'crash' });
  const set = new Set(); while (set.size < mines) set.add(crypto.randomInt(0, 25));
  rounds.set(id, { id, userId, game: 'mines', state: 'open', bet: amount, mines, bombs: set, opened: [] });
  return { roundId: id, mines, balance: b.view.balance, next: minesMult(mines, 1), demo: true };
}
function minesReveal(userId, roundId, idx) {
  const r = getRound(userId, roundId, 'mines');
  if (r.state !== 'open') throw new WalletError('ROUND_CLOSED', '回合已结束', 409);
  idx = Number(idx);
  if (!Number.isInteger(idx) || idx < 0 || idx > 24) throw new WalletError('INVALID_PARAMS', 'idx 取 0-24');
  if (r.opened.includes(idx)) throw new WalletError('ALREADY_OPENED', '该格已翻开', 409);
  if (r.bombs.has(idx)) { r.state = 'done'; r.payout = 0; return { hit: true, bombs: [...r.bombs], balance: wallet.balance(userId).balance, payout: 0 }; }
  r.opened.push(idx);
  const safeTotal = 25 - r.mines;
  const mult = minesMult(r.mines, r.opened.length);
  if (r.opened.length === safeTotal) { const payout = Math.floor(r.bet * mult); const balance = settle(r, payout, userId); return { hit: false, cleared: true, multiplier: mult, payout: payout / 100, balance, bombs: [...r.bombs] }; }
  return { hit: false, multiplier: mult, next: minesMult(r.mines, r.opened.length + 1), opened: r.opened.length };
}
function minesCash(userId, roundId) {
  const r = getRound(userId, roundId, 'mines');
  if (r.state !== 'open') throw new WalletError('ROUND_CLOSED', '回合已结束', 409);
  if (!r.opened.length) throw new WalletError('NOTHING_OPENED', '至少翻开一格后才能提现', 400);
  const mult = minesMult(r.mines, r.opened.length);
  const payout = Math.floor(r.bet * mult);
  const balance = settle(r, payout, userId);
  return { multiplier: mult, payout: payout / 100, balance, bombs: [...r.bombs] };
}
function minesState(userId) { // 断线重连：恢复进行中的回合
  const r = active(userId, 'mines');
  if (!r) return { active: false };
  return { active: true, roundId: r.id, mines: r.mines, opened: r.opened, bet: r.bet / 100, multiplier: minesMult(r.mines, r.opened.length) };
}
module.exports = { crashStart, crashCash, crashPoll, plinkoDrop, plinkoTable, minesStart, minesReveal, minesCash, minesState, crashMult, minesMult, _rounds: rounds };
