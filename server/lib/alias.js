'use strict';
/**
 * 玩家别名映射：内部 user.id（形如 u_ab12…，含下划线）→ 供应商 member_account（仅 a-z0-9，3~20 位）。
 * HUIDU 错误码 10015 要求仅 a-z0-9、10023 要求至少 3 位；文档建议 4~20 位并自定义前缀。
 * 别名 = 前缀 + sha256(userId) 十六进制截断：稳定（同一用户同一供应商永远相同）、不可从别名反推内部 ID、
 * 并在内存映射表里登记以便回调时反查。碰撞（概率极低）时顺延取下一段哈希。
 * 注意：生产必须把映射表持久化（唯一索引 provider+alias），且一旦绑定不可更改（HUIDU 10011 币种锁定、玩家名固定）。
 */
const crypto = require('crypto');
const store = require('./store');

const ALIAS_RE = /^[a-z0-9]{3,20}$/;
const isValidAlias = (a) => typeof a === 'string' && ALIAS_RE.test(a);

function cleanPrefix(p) {
  const x = String(p == null ? 'k8' : p).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10); // HUIDU 要求 member_account 以代理前缀开头；前缀过长会挤占随机部分(总长≤20)
  return x || 'k8';
}
function aliasFor(provider, userId, prefix) {
  const k = `${provider}:${userId}`;
  const ex = store.userToAlias.get(k);
  if (ex) return ex;
  const pre = cleanPrefix(prefix);
  const room = 20 - pre.length;
  const hex = crypto.createHash('sha256').update(`${provider}|${userId}`).digest('hex');
  for (let off = 0; off + room <= hex.length; off += 4) {
    const a = pre + hex.slice(off, off + room);
    const owner = store.aliasToUser.get(`${provider}:${a}`);
    if (!owner || owner === userId) {
      store.aliasToUser.set(`${provider}:${a}`, userId); store.userToAlias.set(k, a);
      return a;
    }
  }
  throw new Error('alias space exhausted');
}
/** 别名 → 内部用户 id。别名是确定性哈希：进程重启后映射表为空时，传入 prefix 可惰性重建（回调可能先于任何 launch 到达）。 */
function resolve(provider, alias, prefix) {
  if (!isValidAlias(alias)) return null;
  let uid = store.aliasToUser.get(`${provider}:${alias}`);
  if (!uid && prefix !== undefined && alias.startsWith(cleanPrefix(prefix))) {
    for (const id of store.users.keys()) aliasFor(provider, id, prefix);
    uid = store.aliasToUser.get(`${provider}:${alias}`);
  }
  return uid && store.users.get(uid) ? uid : null;
}
module.exports = { aliasFor, resolve, isValidAlias, ALIAS_RE };
