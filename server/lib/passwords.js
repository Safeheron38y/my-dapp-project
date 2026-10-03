'use strict';
/** 密码哈希：scrypt（Node 内置，零依赖）。格式  scrypt$N$r$p$saltB64$hashB64  —— 参数写在串里，日后可平滑升级。 */
const crypto = require('crypto');

const N = Number(process.env.SCRYPT_N) || 16384, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 128 * N * R * 2 + 1024 * 1024;

function hashSync(password) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(password), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), h.toString('base64')].join('$');
}
function scryptAsync(pw, salt, n, r, p) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 + 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
}
async function hash(password) {
  const salt = crypto.randomBytes(16);
  const h = await scryptAsync(String(password), salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), h.toString('base64')].join('$');
}
// 恒定时间比较；格式非法返回 false
async function verify(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = +parts[1], r = +parts[2], p = +parts[3];
  if (!(n >= 1024 && n <= 1 << 20 && r >= 1 && r <= 32 && p >= 1 && p <= 4)) return false;
  const salt = Buffer.from(parts[4], 'base64'), want = Buffer.from(parts[5], 'base64');
  const got = await scryptAsync(String(password), salt, n, r, p);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
// 不存在的账号也做一次同等代价的哈希，避免通过响应时间枚举用户名
const DUMMY = hashSync(crypto.randomBytes(8).toString('hex'));
const verifyDummy = (pw) => verify(pw, DUMMY).then(() => false);

// 玩家密码策略：8-64 位，需同时含字母与数字
function policy(pw) {
  if (typeof pw !== 'string') return '请输入密码';
  if (pw.length < 8 || pw.length > 64) return '密码需 8-64 位';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '密码需同时包含字母和数字';
  return null;
}
module.exports = { hash, hashSync, verify, verifyDummy, policy };
