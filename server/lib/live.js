'use strict';
/**
 * 真人视讯“演示结算”：没有真实视频/荷官，使用 mock RNG 即时开牌/开奖，仅用于演示投注流程。
 * 真实视讯供应商由其自己的服务器决定结果，并通过共享钱包回调 /provider/:name/bet|win 结算。
 */
const crypto = require('crypto');
const wallet = require('./wallet');
const { WalletError } = wallet;
const ri = (n) => crypto.randomInt(0, n);

const SPOTS = {
  baccarat: { player: 1, banker: 0.95, tie: 8, pplayer: 11, pbanker: 11 },
  dragontiger: { dragon: 1, tiger: 1, tie: 8 },
  roulette: { red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1, dozen1: 2, dozen2: 2, dozen3: 2 },
  blackjack: { main: 1 },
};
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const pt = (c) => (c >= 10 ? 0 : c);
function cardsVal(a) { return a.reduce((s, c) => s + pt(c), 0) % 10; }

function round(game, spot) {
  if (game === 'baccarat') {
    const P = [1 + ri(13), 1 + ri(13)], B = [1 + ri(13), 1 + ri(13)];
    let p = cardsVal(P), b = cardsVal(B);
    if (p < 8 && b < 8) { if (p <= 5) P.push(1 + ri(13)); if (b <= 5) B.push(1 + ri(13)); p = cardsVal(P); b = cardsVal(B); } // 简化补牌规则(演示)
    const win = p > b ? 'player' : b > p ? 'banker' : 'tie';
    return { cards: { player: P, banker: B }, points: { player: p, banker: b }, win, extra: { pplayer: P[0] === P[1], pbanker: B[0] === B[1] } };
  }
  if (game === 'dragontiger') {
    const d = 1 + ri(13), t = 1 + ri(13);
    return { cards: { dragon: [d], tiger: [t] }, points: { dragon: d, tiger: t }, win: d > t ? 'dragon' : t > d ? 'tiger' : 'tie' };
  }
  if (game === 'roulette') {
    const n = ri(37);
    return { number: n, color: n === 0 ? 'green' : RED.has(n) ? 'red' : 'black', win: String(n) };
  }
  // blackjack：极度简化——庄闲各发两张，闲家不补牌，仅比点(演示)
  const draw = () => Math.min(10, 1 + ri(13));
  const P = [draw(), draw()], D = [draw(), draw()];
  const s = (a) => { let t = a.reduce((x, y) => x + y, 0); if (a.includes(1) && t + 10 <= 21) t += 10; return t; };
  const ps = s(P), ds = s(D);
  return { cards: { player: P, dealer: D }, points: { player: ps, dealer: ds }, win: ps > ds ? 'main' : ps < ds ? 'lose' : 'push' };
}

function settleSpot(game, spot, r) {
  if (game === 'baccarat') {
    if (spot === 'pplayer') return r.extra.pplayer ? 12 : 0;
    if (spot === 'pbanker') return r.extra.pbanker ? 12 : 0;
    if (r.win === 'tie' && spot !== 'tie') return 1; // 和局退回本金
    return r.win === spot ? 1 + SPOTS.baccarat[spot] : 0;
  }
  if (game === 'dragontiger') {
    if (r.win === 'tie' && spot !== 'tie') return 0.5; // 和局输一半(演示规则)
    return r.win === spot ? 1 + SPOTS.dragontiger[spot] : 0;
  }
  if (game === 'roulette') {
    const n = r.number;
    if (/^n\d+$/.test(spot)) return Number(spot.slice(1)) === n ? 36 : 0;
    if (n === 0) return 0;
    const m = { red: r.color === 'red', black: r.color === 'black', odd: n % 2 === 1, even: n % 2 === 0, low: n <= 18, high: n >= 19, dozen1: n <= 12, dozen2: n > 12 && n <= 24, dozen3: n > 24 };
    return m[spot] ? 1 + SPOTS.roulette[spot] : 0;
  }
  if (r.win === 'main') return 2; if (r.win === 'push') return 1; return 0;
}
function validSpot(game, spot) {
  if (!SPOTS[game]) return false;
  if (game === 'roulette' && /^n([0-9]|[1-2][0-9]|3[0-6])$/.test(spot)) return true;
  return Object.prototype.hasOwnProperty.call(SPOTS[game], spot);
}

function play(user, { gameId, game, bets, provider }) {
  if (!SPOTS[game]) throw new WalletError('UNSUPPORTED_GAME', '该游戏暂不支持演示结算', 400);
  if (!Array.isArray(bets) || !bets.length || bets.length > 12) throw new WalletError('INVALID_BETS', '请至少下注一个区域(最多 12 个)');
  let total = 0;
  for (const b of bets) {
    if (!validSpot(game, b.spot)) throw new WalletError('INVALID_SPOT', '无效下注区: ' + b.spot);
    if (!Number.isInteger(b.amountMinor) || b.amountMinor <= 0) throw new WalletError('INVALID_AMOUNT', '金额无效');
    total += b.amountMinor;
  }
  const id = 'lv_' + crypto.randomBytes(6).toString('hex');
  const bet = wallet.bet({ provider, userId: user.id, txId: id + ':bet', amountMinor: total, roundId: id, gameId, category: 'live', meta: { demo: true, bets } });
  const r = round(game, null);
  let payout = 0;
  for (const b of bets) payout += Math.floor(b.amountMinor * settleSpot(game, b.spot, r));
  let balance = bet.view.balance;
  if (payout > 0) balance = wallet.win({ provider, userId: user.id, txId: id + ':win', amountMinor: payout, roundId: id, gameId, category: 'live' }).view.balance;
  return { roundId: id, result: r, stake: total / 100, payout: payout / 100, balance, demo: true, note: '演示结算：mock RNG，非真实视频荷官' };
}
module.exports = { play, SPOTS };
