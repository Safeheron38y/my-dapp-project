'use strict';
const crypto = require('crypto');

// 签名占位方案（可被各 adapter 覆盖）：
//   X-Timestamp: 毫秒时间戳
//   X-Signature: hex( HMAC_SHA256(secret, `${timestamp}.${rawBody}`) )
//   X-Api-Key  : 供应商 apiKey（可选的第二重校验）
function sign(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}
function safeEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}
function verify({ secret, timestamp, signature, rawBody, toleranceSec = 300, now = Date.now() }) {
  if (!secret) return { ok: false, reason: 'NO_SECRET_CONFIGURED' };
  if (!timestamp || !signature) return { ok: false, reason: 'MISSING_SIGNATURE' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSec * 1000) return { ok: false, reason: 'TIMESTAMP_OUT_OF_RANGE' };
  const exp = sign(secret, timestamp, rawBody);
  return safeEq(exp, String(signature).toLowerCase()) ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
}
module.exports = { sign, verify, safeEq };
