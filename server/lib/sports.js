'use strict';
/** 体育博彩 mock：示例赛事与赔率(全部虚构)。真实环境由体育数据/赔率供应商(Sportsbook adapter)提供。 */
const crypto = require('crypto');
const wallet = require('./wallet');
const store = require('./store');
const { WalletError } = wallet;
const PROV = 'sportsbook';

const H = 3600 * 1000;
const seed = [
  ['football', '足球', '示例联赛', '沙漠之鹰', '霓虹猛虎', 1.85, 3.4, 4.2, -25 * 60e3, true],
  ['football', '足球', '示例联赛', '极光骑士', '赤焰联', 2.4, 3.1, 2.9, 2 * H, false],
  ['football', '足球', '示例杯赛', '海湾水手', '银岭守望', 1.62, 3.8, 5.4, 5 * H, false],
  ['football', '足球', '示例杯赛', '琥珀城', '翡翠联', 2.95, 3.2, 2.35, 26 * H, false],
  ['basketball', '篮球', '示例篮球联赛', '雷霆之翼', '暮光巨人', 1.72, null, 2.1, -40 * 60e3, true],
  ['basketball', '篮球', '示例篮球联赛', '月光猎手', '烈焰队', 2.05, null, 1.76, 3 * H, false],
  ['basketball', '篮球', '示例篮球联赛', '星河队', '白塔队', 1.48, null, 2.65, 28 * H, false],
  ['esports', '电竞', '示例电竞赛', '零点战队', '极昼战队', 1.9, null, 1.9, 1 * H, false],
  ['esports', '电竞', '示例电竞赛', '孤星战队', '流火战队', 2.3, null, 1.6, 6 * H, false],
  ['tennis', '网球', '示例公开赛', '选手甲', '选手乙', 1.55, null, 2.4, 4 * H, false],
];
const events = seed.map((s, i) => ({
  id: 'ev' + (i + 1), sport: s[0], sportLabel: s[1], league: s[2], home: s[3], away: s[4],
  startsAt: Date.now() + s[8], live: s[9], demo: true,
  markets: [{
    id: 'm1', name: s[5] && s[6] ? '胜平负' : '独赢',
    outcomes: [
      { id: 'h', name: s[3], odds: s[5] },
      ...(s[6] ? [{ id: 'd', name: '平局', odds: s[6] }] : []),
      { id: 'a', name: s[4], odds: s[7] },
    ],
  }],
  score: s[9] ? [Math.floor(Math.random() * 3), Math.floor(Math.random() * 3)] : null,
}));
const evById = new Map(events.map((e) => [e.id, e]));

// 模拟赔率轻微波动(仅 live 场次)，用于演示“赔率变动”处理
const jit = setInterval(() => {
  for (const e of events) if (e.live) for (const o of e.markets[0].outcomes) {
    const d = (Math.random() - 0.5) * 0.06; o.odds = Math.max(1.05, Math.round((o.odds + d) * 100) / 100);
  }
}, 8000);
jit.unref();

function listEvents({ sport, live } = {}) {
  return events.filter((e) => (!sport || e.sport === sport) && (live == null || e.live === (live === 'true' || live === true)))
    .map((e) => ({ id: e.id, sport: e.sport, sportLabel: e.sportLabel, league: e.league, home: e.home, away: e.away, startsAt: e.startsAt, live: e.live, score: e.score, markets: e.markets, demo: true }));
}

/**
 * 下注：selections=[{eventId,marketId,outcomeId,odds}]，stake(主币单位)，type=single|parlay
 * 赔率保护：客户端提交的 odds 与当前不一致 → 409 ODDS_CHANGED（返回最新赔率），除非 acceptOddsChange=true。
 */
function placeBet(user, { selections, stakeMinor, type, acceptOddsChange, clientKey }) {
  if (!Array.isArray(selections) || !selections.length || selections.length > 10) throw new WalletError('INVALID_SELECTIONS', '请选择 1-10 个投注项');
  if (type !== 'parlay' && selections.length > 1) throw new WalletError('INVALID_SELECTIONS', '单关只能选择 1 个投注项（多个请使用 type=parlay 串关）');
  if (type === 'parlay' && selections.length < 2) throw new WalletError('INVALID_SELECTIONS', '串关至少 2 个投注项');
  const seen = new Set(); const resolved = []; const changed = [];
  for (const s of selections) {
    const ev = evById.get(s.eventId);
    if (!ev) throw new WalletError('EVENT_NOT_FOUND', '赛事不存在: ' + s.eventId, 404);
    if (seen.has(ev.id)) throw new WalletError('SAME_EVENT', '串关不能包含同一赛事的多个选项');
    seen.add(ev.id);
    if (!ev.live && ev.startsAt < Date.now()) throw new WalletError('EVENT_CLOSED', '赛事已封盘');
    const mk = ev.markets.find((m) => m.id === s.marketId); const out = mk && mk.outcomes.find((o) => o.id === s.outcomeId);
    if (!out) throw new WalletError('OUTCOME_NOT_FOUND', '投注项不存在');
    if (Number(s.odds) !== out.odds) changed.push({ eventId: ev.id, marketId: mk.id, outcomeId: out.id, oldOdds: Number(s.odds), odds: out.odds });
    resolved.push({ eventId: ev.id, marketId: mk.id, outcomeId: out.id, desc: `${ev.home} vs ${ev.away} · ${out.name}`, odds: out.odds });
  }
  if (changed.length && !acceptOddsChange) throw new WalletError('ODDS_CHANGED', '赔率已变动，请确认后重新提交', 409, { changed });
  const totalOdds = Math.round(resolved.reduce((a, s) => a * s.odds, 1) * 100) / 100;
  const id = 'sb_' + (clientKey ? crypto.createHash('sha256').update(clientKey).digest('hex').slice(0, 12) : crypto.randomBytes(6).toString('hex'));
  const r = wallet.bet({ provider: PROV, userId: user.id, txId: clientKey ? 'sb-' + clientKey : id + ':bet', amountMinor: stakeMinor, roundId: id, gameId: 'sports', category: 'sports' });
  if (r.duplicate) { // 同一 Idempotency-Key 重放：返回原注单
    const orig = [...store.sportsBets.values()].find((b) => b.txId === r.entry.txId);
    if (orig) return { bet: pub(orig), balance: r.view.balance, duplicate: true };
  }
  const bet = { id, userId: user.id, type: type === 'parlay' ? 'parlay' : 'single', selections: resolved, stake: stakeMinor, totalOdds, potential: Math.floor(stakeMinor * totalOdds), status: 'open', placedAt: Date.now(), txId: r.entry.txId, demo: true };
  store.sportsBets.set(id, bet);
  return { bet: pub(bet), balance: r.view.balance, duplicate: false, oddsChanged: changed };
}
const pub = (b) => ({ id: b.id, type: b.type, selections: b.selections, stake: b.stake / 100, totalOdds: b.totalOdds, potentialPayout: b.potential / 100, status: b.status, placedAt: b.placedAt, payout: b.payout != null ? b.payout / 100 : null, demo: true });
function listBets(userId) { return [...store.sportsBets.values()].filter((b) => b.userId === userId).sort((a, b) => b.placedAt - a.placedAt).map(pub); }

// 开发用：手动结算 won|lost|void
function settle(betId, result) {
  const b = store.sportsBets.get(betId);
  if (!b) throw new WalletError('BET_NOT_FOUND', '注单不存在', 404);
  if (b.status !== 'open') throw new WalletError('BET_SETTLED', '注单已结算', 409);
  let balance;
  if (result === 'won') { balance = wallet.win({ provider: PROV, userId: b.userId, txId: b.id + ':win', amountMinor: b.potential, roundId: b.id, gameId: 'sports', category: 'sports' }).view.balance; b.payout = b.potential; }
  else if (result === 'void') { balance = wallet.refund({ provider: PROV, userId: b.userId, txId: b.id + ':refund', refTxId: b.txId }).view.balance; b.payout = b.stake; }
  else if (result === 'lost') { b.payout = 0; balance = wallet.balance(b.userId).balance; }
  else throw new WalletError('INVALID_RESULT', 'result 取 won|lost|void');
  b.status = result; return { bet: pub(b), balance };
}
module.exports = { listEvents, placeBet, listBets, settle };
