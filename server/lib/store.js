'use strict';
// 内存存储。生产环境请换成数据库(PostgreSQL 等)：
//  - ledger 对 (provider, txId) 建唯一索引实现幂等
//  - 余额变更与 ledger 写入放在同一数据库事务中，并对用户行加锁(SELECT ... FOR UPDATE)
const crypto = require('crypto');
const config = require('./config');

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

function createUser(username, region) {
  const id = uid('u');
  const u = { id, username, region, balance: Math.round(config.regions.startingBalance * 100), createdAt: Date.now() };
  users.set(id, u); byName.set(username, id); ledgerByUser.set(id, []);
  return u;
}
function ledgerOf(userId) { return ledgerByUser.get(userId) || []; }
function addEntry(e) {
  ledger.set(`${e.provider}:${e.txId}`, e);
  ledgerByUser.get(e.userId).push(e);
}
module.exports = { users, byName, sessions, launches, ledger, ledgerByUser, clientIdem, sportsBets, aliasToUser, userToAlias, uid, createUser, ledgerOf, addEntry };
