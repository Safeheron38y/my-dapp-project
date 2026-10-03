'use strict';
// 负责任博彩(Responsible Gambling)钩子 —— 目前为轻量桩实现(内存)。
// 接入真实合规系统(自我排除登记库、KYC/年龄核验、冷静期、现实检查)时，替换这些函数即可，调用点已在 wallet.js / routes.js 中就位。
const store = require('./store');
const geo = require('./geo');

function state(userId) {
  const u = store.users.get(userId);
  if (!u.rg) u.rg = { selfExcludedUntil: 0, coolOffUntil: 0, dailyDepositLimit: null, dailyLossLimit: null, sessionStart: Date.now() };
  return u.rg;
}
// 返回 null 表示允许；否则 {code,message}
function beforeBet(userId, amountMinor, ctx) {
  const s = state(userId), now = Date.now();
  if (store.users.get(userId).frozen) return { code: 'ACCOUNT_FROZEN', message: '账户已被冻结，请联系客服' };
  if (s.selfExcludedUntil > now) return { code: 'SELF_EXCLUDED', message: '账户处于自我排除期，暂不可投注' };
  if (s.coolOffUntil > now) return { code: 'COOL_OFF', message: '账户处于冷静期，暂不可投注' };
  // TODO: dailyLossLimit —— 需要按日汇总净输额，此处留桩
  return null;
}
function beforeDeposit(userId, amountMinor) {
  const s = state(userId), now = Date.now();
  if (store.users.get(userId).frozen) return { code: 'ACCOUNT_FROZEN', message: '账户已被冻结，请联系客服' };
  if (s.selfExcludedUntil > now) return { code: 'SELF_EXCLUDED', message: '账户处于自我排除期，暂不可充值' };
  if (s.dailyDepositLimit != null) {
    const since = now - 24 * 3600 * 1000;
    let sum = 0;
    for (const e of store.ledgerOf(userId)) if (e.type === 'deposit' && e.createdAt >= since) sum += e.amount;
    if (sum + amountMinor > s.dailyDepositLimit) return { code: 'USER_DEPOSIT_LIMIT', message: '超过您自行设置的每日充值限额' };
  }
  return null;
}
function realityCheck(userId) {
  const u = store.users.get(userId);
  const mins = geo.regionCfg(u.region).realityCheckMinutes;
  const s = state(userId);
  const elapsed = Math.floor((Date.now() - s.sessionStart) / 60000);
  return { enabled: !!mins, intervalMinutes: mins || null, sessionMinutes: elapsed, due: !!mins && elapsed >= mins };
}
function status(userId) {
  const s = state(userId);
  return {
    selfExcludedUntil: s.selfExcludedUntil || null, coolOffUntil: s.coolOffUntil || null,
    dailyDepositLimit: s.dailyDepositLimit == null ? null : s.dailyDepositLimit / 100,
    dailyLossLimit: s.dailyLossLimit == null ? null : s.dailyLossLimit / 100,
    realityCheck: realityCheck(userId), stub: true,
  };
}
function setLimits(userId, { dailyDepositLimitMinor, dailyLossLimitMinor }) {
  const s = state(userId);
  if (dailyDepositLimitMinor !== undefined) s.dailyDepositLimit = dailyDepositLimitMinor;
  if (dailyLossLimitMinor !== undefined) s.dailyLossLimit = dailyLossLimitMinor;
}
function selfExclude(userId, hours, kind) {
  const s = state(userId);
  const until = Date.now() + hours * 3600 * 1000;
  if (kind === 'cooloff') s.coolOffUntil = until; else s.selfExcludedUntil = until;
  return until;
}
module.exports = { beforeBet, beforeDeposit, realityCheck, status, setLimits, selfExclude, state };
