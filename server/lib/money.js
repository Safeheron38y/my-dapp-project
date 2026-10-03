'use strict';
// 金额一律以“分”(整数)存储与计算，避免浮点误差。对外 API 使用最多 2 位小数的 number。
function toMinor(v) {
  if (typeof v === 'string' && /^\d+(\.\d{1,2})?$/.test(v)) v = Number(v);
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const m = Math.round(v * 100);
  if (Math.abs(m / 100 - v) > 1e-9) return null; // 超过 2 位小数
  if (m < 0 || m > Number.MAX_SAFE_INTEGER / 1000) return null;
  return m;
}
const toMajor = (m) => m / 100;
module.exports = { toMinor, toMajor };
