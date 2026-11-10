/** 部门列表（注册选择/筛选使用） */
import { Router } from 'express';
import { query } from '../db.js';
import { ok } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../errors.js';

export const departmentsRouter = Router();

departmentsRouter.get('/', requireAuth, asyncHandler(async (_req, res) => {
  const rows = await query('SELECT id, name, description FROM departments ORDER BY id');
  ok(res, rows);
}));
