/**
 * 数据库访问层：mysql2 连接池 + 事务助手。
 * 所有 SQL 一律参数化，杜绝注入。
 */
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  timezone: '+08:00',
  charset: 'utf8mb4',
  // DATE/DATETIME 返回字符串（避免时区与 Date 对象偏差），DECIMAL 返回数字（金额）
  dateStrings: true,
  decimalNumbers: true,
  // 注意：不开 jsonStrings —— JSON 列仍由 mysql2 解析为对象/数组，统一用 helpers.parseJson 读取
});

/** 单条查询：返回行数组 */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** 单条查询：返回第一行或 null */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/**
 * 事务助手：fn(conn) 内所有写操作在事务中执行，异常自动回滚。
 * 审批流转、提交等关键路径必须使用事务。
 */
export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

/** 取系统配置（带缓存失效策略的简化版：每次读库，配置项少、频率低） */
export async function getSystemConfig(key) {
  const row = await queryOne('SELECT value FROM system_configs WHERE `key` = ?', [key]);
  return row ? row.value : null;
}

/** 取企业负责人加签金额阈值（分），默认 100000 元 = 10_000_000 分 */
export async function getCompanyHeadThreshold() {
  const v = await getSystemConfig('company_head_threshold_cents');
  return v === null ? 10_000_000 : Number(v);
}
