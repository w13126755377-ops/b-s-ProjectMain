/**
 * 环境配置：全部来自环境变量，提供本地开发默认值。
 * 生产/Docker 环境通过 docker-compose.yml / .env 注入。
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    database: process.env.DB_NAME || 'approval_db',
    connectionLimit: 10,
  },
  jwt: {
    secret: process.env.JWT_SECRET || (() => {
      // 本地开发兜底：生成随机密钥（重启后登录态失效）；生产/Docker 务必显式配置 JWT_SECRET
      console.warn('[config] 未设置 JWT_SECRET，已生成随机密钥（重启后需重新登录）；生产环境请通过 .env 显式配置');
      return crypto.randomBytes(32).toString('hex');
    })(),
    expiresIn: process.env.JWT_EXPIRES || '7d',
  },
  upload: {
    dir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
    maxFileMb: 10, // 单文件上限 10MB（作业要求）
  },
  push: {
    // Web Push（可选增强）：未配置 VAPID 时自动禁用，不影响其他功能
    enabled: process.env.PUSH_ENABLED === 'true',
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
  timezone: 'Asia/Shanghai',
};
