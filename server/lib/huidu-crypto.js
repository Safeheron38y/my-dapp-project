'use strict';
/**
 * HUIDU GameApi 加解密（严格按 ANALYSIS.md §3.2 / 供应商文档）：
 *   算法  AES-256-ECB（无 IV）　填充 PKCS7　输出 Base64（标准字母表）
 *   密钥  32 个 ASCII 字符，直接取 UTF-8 字节作为 32 字节密钥（Java key.getBytes() / CryptoJS Utf8.parse）
 *   明文  JSON 字符串（字段无需排序）
 * ⚠ ECB 无完整性保护、无 nonce：认证等同于“持有密钥”。安全补偿见 API.md（IP 白名单 / 幂等 / 对账 / TLS）。
 * 不要把任何真实/文档示例密钥写进源码——密钥只能来自环境变量 HUIDU_AES_KEY。
 */
const crypto = require('crypto');

class HuiduCryptoError extends Error {
  constructor(msg) { super(msg); this.name = 'HuiduCryptoError'; this.code = 'PAYLOAD_ERROR'; }
}
function keyBuf(key) {
  if (typeof key !== 'string') throw new HuiduCryptoError('aes key must be a string');
  const b = Buffer.from(key, 'utf8');
  if (b.length !== 32) throw new HuiduCryptoError('aes key must be exactly 32 bytes (got ' + b.length + ')');
  return b;
}
const validKey = (key) => typeof key === 'string' && Buffer.byteLength(key, 'utf8') === 32;

/** 明文(对象或字符串) → Base64 密文 */
function encrypt(plain, key) {
  const text = typeof plain === 'string' ? plain : JSON.stringify(plain);
  const c = crypto.createCipheriv('aes-256-ecb', keyBuf(key), null); // 默认 PKCS#7 填充
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
}
/** Base64 密文 → 明文字符串。失败统一抛 HuiduCryptoError('payload error') */
function decryptText(b64, key) {
  const kb = keyBuf(key);
  if (typeof b64 !== 'string' || !b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new HuiduCryptoError('payload error');
  try {
    const d = crypto.createDecipheriv('aes-256-ecb', kb, null);
    return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
  } catch { throw new HuiduCryptoError('payload error'); }
}
/** Base64 密文 → JSON 对象 */
function decrypt(b64, key) {
  const t = decryptText(b64, key);
  try { const o = JSON.parse(t); if (o === null || typeof o !== 'object') throw 0; return o; } catch { throw new HuiduCryptoError('payload error'); }
}
module.exports = { encrypt, decrypt, decryptText, validKey, HuiduCryptoError };
