/** 通用小工具 */
import crypto from 'node:crypto';

/** 文件 MD5（用于重复票据预警） */
export function md5Buffer(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

/** 金额（分）→ 元字符串，展示用，如 123456 -> "1234.56" */
export function centsToYuan(cents) {
  const n = Number(cents ?? 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const yuan = Math.floor(abs / 100);
  const fen = String(abs % 100).padStart(2, '0');
  return `${sign}${yuan}.${fen}`;
}

/** 元字符串 -> 分（整数），如 "1234.56" -> 123456。非两位小数抛错。前端提交金额一律转分。 */
export function yuanToCents(input) {
  if (typeof input !== 'string' && typeof input !== 'number') throw new Error('金额格式错误');
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`金额格式错误：${input}`);
  const [intPart, decPart = ''] = s.split('.');
  return Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
}

/** 出差天数口径：ceil((结束-开始)/24h)，不足一天按一天计（自然日-时长口径） */
export function travelDays(startIso, endIso) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** 允许的票据/附件 MIME 与扩展名 */
export const ALLOWED_FILE = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};

export function isAllowedFile(mime, ext) {
  const exts = ALLOWED_FILE[mime];
  return !!exts && exts.includes(ext.toLowerCase());
}
