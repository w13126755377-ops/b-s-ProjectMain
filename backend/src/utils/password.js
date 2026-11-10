/** 密码哈希（bcrypt，cost=10），绝不保存明文。 */
import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

/** 密码策略：至少 8 个字符（作业要求），建议含字母数字 */
export function validatePassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    return '密码长度至少 8 个字符';
  }
  if (plain.length > 64) {
    return '密码长度不能超过 64 个字符';
  }
  return null;
}
