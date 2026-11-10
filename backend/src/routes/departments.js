/**
 * 部门列表：公开接口（注册页选择部门需要，不含敏感信息）。
 * 管理端部门增删改在 /api/admin/departments（requireAdmin + 审计）。
 */
import { Router } from 'express';
import { query } from '../db.js';
import { ok } from '../errors.js';
import { asyncHandler } from '../errors.js';

export const departmentsRouter = Router();

departmentsRouter.get('/', asyncHandler(async (_req, res) => {
  const rows = await query('SELECT id, name, description FROM departments ORDER BY id');
  ok(res, rows);
}));
