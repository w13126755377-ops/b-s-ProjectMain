/**
 * 认证与权限中间件。
 * - requireAuth：解析 JWT，加载用户（含角色、部门）到 req.user
 * - requireRole(...codes)：接口级角色校验
 * 注意：这里只做"身份/角色"检查；数据范围（本人/审批人）由各服务层 SQL 强制过滤，
 * 权限检查全部在服务端执行，前端隐藏按钮仅为体验优化。
 */
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { queryOne } from '../db.js';
import { AppError, forbidden, unauthorized } from '../errors.js';

export const ROLE = {
  EMPLOYEE: 'EMPLOYEE',
  DEPT_HEAD: 'DEPT_HEAD',
  FINANCE: 'FINANCE',
  COMPANY_HEAD: 'COMPANY_HEAD',
  ADMIN: 'ADMIN',
};

/** 加载完整用户信息（含角色码列表、部门） */
export async function loadUser(userId) {
  const user = await queryOne(
    `SELECT u.id, u.username, u.email, u.name, u.dept_id, u.status, u.created_at,
            d.name AS dept_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.dept_id
     WHERE u.id = ?`,
    [userId]
  );
  if (!user) return null;
  const roles = await queryOne(
    `SELECT GROUP_CONCAT(r.code) AS codes FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    [userId]
  );
  user.roleCodes = roles && roles.codes ? roles.codes.split(',') : [];
  user.isAdmin = user.roleCodes.includes(ROLE.ADMIN);
  return user;
}

/** 解析并注入用户，必须登录 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
    if (!token) throw unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch {
      throw unauthorized('登录已过期，请重新登录');
    }
    const user = await loadUser(payload.uid);
    if (!user) throw unauthorized();
    if (user.status !== 'ACTIVE') throw forbidden('账号已被停用，请联系管理员');
    req.user = user;
    next();
  } catch (err) {
    next(err instanceof AppError ? err : unauthorized());
  }
}

/** 要求用户拥有指定角色之一 */
export function requireRole(...codes) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!codes.some((c) => req.user.roleCodes.includes(c))) {
      return next(forbidden('需要更高权限角色才能执行该操作'));
    }
    next();
  };
}

/** 要求系统管理员 */
export const requireAdmin = requireRole(ROLE.ADMIN);
