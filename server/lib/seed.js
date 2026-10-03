'use strict';
/**
 * 演示账号种子（仅演示用！上线前务必关闭或改密）。
 *  玩家： test01 / test02 / test03，演示币余额 10000，密码 Test@2026
 *  管理员：admin / Admin@2026!（见 lib/adminstate.js）
 * 环境变量覆盖：
 *  SEED_DEMO=0                 不创建演示玩家
 *  DEMO_PLAYERS=a,b,c          演示玩家用户名列表
 *  DEMO_PLAYER_PASSWORD=...    演示玩家密码（设置后每次启动都会把这些账号的密码重置为该值）
 *  DEMO_PLAYER_BALANCE=10000   新建时的初始演示币
 *  ADMIN_USERNAME / ADMIN_PASSWORD   管理员账号（设置后每次启动以它为准，ADMIN_PASSWORD_FORCE=0 则仅在账号不存在时创建）
 * 已存在的账号（来自 DATA_DIR 持久化数据）不会被重置余额。
 */
const store = require('./store');
const config = require('./config');
const passwords = require('./passwords');

function seedPlayers() {
  if (process.env.SEED_DEMO === '0') return [];
  const names = (process.env.DEMO_PLAYERS || 'test01,test02,test03').split(',').map((s) => s.trim()).filter(Boolean);
  const envPw = process.env.DEMO_PLAYER_PASSWORD;
  const pw = envPw || 'Test@2026';
  const bal = Math.round((Number(process.env.DEMO_PLAYER_BALANCE) || 10000) * 100);
  const out = [];
  for (const n of names) {
    let u = store.users.get(store.byName.get(n));
    if (!u) { u = store.createUser(n, config.regions.defaultRegion || 'default', { pw: passwords.hashSync(pw), balance: bal, demoSeed: true }); }
    else if (!u.pw || envPw) { u.pw = passwords.hashSync(pw); store.markDirty('users'); }
    out.push(u.username);
  }
  return out;
}
module.exports = { seedPlayers };
