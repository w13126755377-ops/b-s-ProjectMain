/**
 * 审批委托路由（我的委托）。
 * 创建校验：受托人为启用用户、非本人、时间范围有效。
 * 生效口径：提交时解析节点审批人（见 approvalService.resolveNodeApprover）。
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { badRequest, conflict, notFound, ok, asyncHandler } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const delegationsRouter = Router();
delegationsRouter.use(requireAuth);

delegationsRouter.get('/', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT d.id, d.delegatee_id, u.name AS delegatee_name, u.username AS delegatee_username,
            d.start_time, d.end_time, d.enabled, d.reason, d.created_at
     FROM delegations d JOIN users u ON u.id = d.delegatee_id
     WHERE d.user_id = ?
     ORDER BY d.id DESC`,
    [req.user.id]
  );
  ok(res, rows);
}));

const createSchema = z.object({
  delegateeId: z.number().int().positive('请选择受托人'),
  startTime: z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, '开始时间格式不正确'),
  endTime: z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, '结束时间格式不正确'),
  reason: z.string().trim().min(1, '请填写委托原因').max(200),
}).superRefine((v, ctx) => {
  if (new Date(v.endTime).getTime() <= new Date(v.startTime).getTime()) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: '结束时间必须晚于开始时间' });
  }
});

delegationsRouter.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  const { delegateeId, startTime, endTime, reason } = req.body;
  if (delegateeId === req.user.id) throw badRequest('不能委托给自己');
  const target = await queryOne('SELECT id, status FROM users WHERE id = ?', [delegateeId]);
  if (!target) throw badRequest('受托人不存在');
  if (target.status !== 'ACTIVE') throw badRequest('受托人已停用');
  // 与现有生效委托时间重叠检查（同委托人）
  const overlap = await queryOne(
    `SELECT id FROM delegations
     WHERE user_id = ? AND enabled = 1 AND start_time <= ? AND end_time >= ?`,
    [req.user.id, endTime.replace('T', ' '), startTime.replace('T', ' ')]
  );
  if (overlap) throw conflict('与现有生效中的委托时间重叠，请先停用原委托');
  const r = await query(
    `INSERT INTO delegations (user_id, delegatee_id, start_time, end_time, enabled, reason, created_at)
     VALUES (?, ?, ?, ?, 1, ?, NOW())`,
    [req.user.id, delegateeId, startTime.replace('T', ' '), endTime.replace('T', ' '), reason]
  );
  ok(res, { id: r.insertId }, '委托已创建');
}));

delegationsRouter.patch('/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ enabled: z.boolean() }) }), asyncHandler(async (req, res) => {
  const d = await queryOne('SELECT * FROM delegations WHERE id = ?', [req.params.id]);
  if (!d) throw notFound('委托不存在');
  if (d.user_id !== req.user.id) throw notFound('委托不存在');
  await query('UPDATE delegations SET enabled = ? WHERE id = ?', [req.body.enabled ? 1 : 0, req.params.id]);
  ok(res, null, req.body.enabled ? '委托已启用' : '委托已停用');
}));

delegationsRouter.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), asyncHandler(async (req, res) => {
  const d = await queryOne('SELECT * FROM delegations WHERE id = ?', [req.params.id]);
  if (!d || d.user_id !== req.user.id) throw notFound('委托不存在');
  await query('DELETE FROM delegations WHERE id = ?', [req.params.id]);
  ok(res, null, '委托已删除');
}));
