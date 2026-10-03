'use strict';
// 内存存储。生产环境请换成数据库(PostgreSQL 等)：
//  - ledger 对 (provider, txId) 建唯一索引实现幂等
//  - 余额变更与 ledger 写入放在同一数据库事务中，并对用户行加锁(SELECT ... FOR UPDATE)
const crypto = require('crypto');
const config = require('./config');
const persist = require('./persist');

const users = new Map();       // userId -> user
const byName = new Map();      // username -> userId
const sessions = new Map();    // token -> {userId, exp}
const launches = new Map();    // launchToken -> {userId, gameId, provider, exp}
const ledger = new Map();      // `${provider}:${txId}` -> entry
const ledgerByUser = new Map();// userId -> entry[]
const clientIdem = new Map();  // `${userId}:${key}` -> {hash,response}
const sportsBets = new Map();  // betId -> bet
const aliasToUser = new Map(); // `${provider}:${alias}` -> userId   (供应商 member_account 别名，仅 a-z0-9)
const userToAlias = new Map(); // `${provider}:${userId}` -> alias
const uid = (p) => p + '_' + crypto.randomBytes(8).toString('hex');

// ---- 持久化（DATA_DIR/users.json、ledger.json；见 lib/persist.js）----
const LEDGER_KEEP = Number(process.env.LEDGER_PERSIST_MAX) || 20000; // 只持久化最近 N 条账本，防止文件无限增长
function markDirty(which) {
  if (!persist.enabled()) return;
  if (which !== 'ledger') persist.schedule('users', () => ({ v: 1, users: [...users.values()] }));
  if (which !== 'users') persist.schedule('ledger', () => { const all = [...ledger.values()]; return { v: 1, entries: all.length > LEDGER_KEEP ? all.slice(all.length - LEDGER_KEEP) : all }; });
}
function loadPersisted() {
  if (!persist.enabled()) return;
  const U = persist.load('users', { users: [] }), L = persist.load('ledger', { entries: [] });
  for (const u of U.users || []) { users.set(u.id, u); byName.set(u.username, u.id); ledgerByUser.set(u.id, []); }
  const es = (L.entries || []).filter((e) => e && e.userId && ledgerByUser.has(e.userId)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const e of es) { ledger.set(`${e.provider}:${e.txId}`, e); ledgerByUser.get(e.userId).push(e); }
  persist.hookExit();
}
loadPersisted();

// pw: scrypt 哈希串（见 lib/passwords.js）；未设密码的账号（旧数据/测试夹具）无法登录
function createUser(username, region, extra) {
  const id = uid('u');
  const u = Object.assign({ id, username, region, balance: Math.round(config.regions.startingBalance * 100), createdAt: Date.now(), frozen: false }, extra);
  users.set(id, u); byName.set(username, id); ledgerByUser.set(id, []);
  markDirty('users');
  return u;
}
function ledgerOf(userId) { return ledgerByUser.get(userId) || []; }
function addEntry(e) {
  ledger.set(`${e.provider}:${e.txId}`, e);
  ledgerByUser.get(e.userId).push(e);
  markDirty();
}
module.exports = { users, byName, sessions, launches, ledger, ledgerByUser, clientIdem, sportsBets, aliasToUser, userToAlias, uid, createUser, ledgerOf, addEntry, markDirty };
