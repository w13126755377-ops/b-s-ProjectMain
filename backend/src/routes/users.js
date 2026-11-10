/** 个人信息路由 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { badRequest, forbidden, ok } from '../errors.js';
import { requireAuth, loadUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { hashPassword, verifyPassword, validatePassword } from '../utils/password.js';
import { asyncHandler } from '../errors.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/me', asyncHandler(async (req, res) => {
  ok(res, await loadUser(req.user.id));
}));

/** 用户搜索（受托人/指定审批人选择用）：仅返回启用用户，不含敏感信息 */
usersRouter.get('/search', validate({ query: z.object({
  keyword: z.string().trim().min(1, '请输入关键字').max(50),
  excludeSelf: z.enum(['0', '1']).optional().default('0'),
}) }), asyncHandler(async (req, res) => {
  const like = `%${req.query.keyword}%`;
  const rows = await query(
    `SELECT u.id, u.username, u.name, u.dept_id, d.name AS dept_name
     FROM users u LEFT JOIN departments d ON d.id = u.dept_id
     WHERE u.status = 'ACTIVE'
       ${req.query.excludeSelf === '1' ? 'AND u.id <> ?' : ''}
       AND (u.username LIKE ? OR u.name LIKE ?)
     ORDER BY u.username LIMIT 20`,
    req.query.excludeSelf === '1' ? [req.user.id, like, like] : [like, like]
  );
  ok(res, rows);
}));

const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(32).optional(),
  email: z.string().email().max(128).optional(),
  oldPassword: z.string().optional(),
  newPassword: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.newPassword && !v.oldPassword) {
    ctx.addIssue({ code: 'custom', path: ['oldPassword'], message: '修改密码需要提供旧密码' });
  }
  if (v.newPassword) {
    const e = validatePassword(v.newPassword);
    if (e) ctx.addIssue({ code: 'custom', path: ['newPassword'], message: e });
  }
});

usersRouter.patch('/me', validate({ body: updateMeSchema }), asyncHandler(async (req, res) => {
  const { name, email, oldPassword, newPassword } = req.body;
  const sets = [];
  const params = [];

  if (name) { sets.push('name = ?'); params.push(name); }
  if (email) {
    const exists = await queryOne('SELECT id FROM users WHERE email = ? AND id <> ?', [email.toLowerCase(), req.user.id]);
    if (exists) throw badRequest('该邮箱已被其他账号使用（邮箱必须唯一）');
    sets.push('email = ?'); params.push(email.toLowerCase());
  }
  if (newPassword) {
    const me = await queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(oldPassword || '', me.password_hash)) throw badRequest('旧密码不正确');
    sets.push('password_hash = ?'); params.push(hashPassword(newPassword));
  }
  if (!sets.length) throw badRequest('没有需要修改的内容');
  params.push(req.user.id);
  const { query } = await import('../db.js');
  await query(`UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  ok(res, await loadUser(req.user.id), '修改成功');
}));
