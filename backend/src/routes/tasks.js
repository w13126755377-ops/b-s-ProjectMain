/** 待办/已办与审批操作路由 */
import { Router } from 'express';
import { z } from 'zod';
import { transaction } from '../db.js';
import { badRequest, ok, asyncHandler } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listTasks } from '../services/applicationService.js';
import { approveTask, rejectTask, dispatchAfterCommit } from '../services/approvalService.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const scopeSchema = z.object({
  scope: z.enum(['todo', 'done']).optional().default('todo'),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

tasksRouter.get('/', validate({ query: scopeSchema }), asyncHandler(async (req, res) => {
  const rows = await listTasks(req.user, req.query.scope);
  ok(res, rows);
}));

const instanceParam = z.object({ instanceId: z.coerce.number().int().positive() });

/** 批准（意见可选）。非当前审批人/本人申请一律拒绝；并发重复操作返回 409。 */
tasksRouter.post('/:instanceId/approve',
  validate({ params: instanceParam, body: z.object({ comment: z.string().trim().max(500).optional().default('') }) }),
  asyncHandler(async (req, res) => {
    const result = await transaction((conn) => approveTask(conn, req.user, req.params.instanceId, req.body.comment));
    await dispatchAfterCommit(result);
    ok(res, null, '已批准');
  }));

/** 驳回（理由必填） */
tasksRouter.post('/:instanceId/reject',
  validate({ params: instanceParam, body: z.object({ reason: z.string().trim().min(1, '驳回必须填写理由').max(500) }) }),
  asyncHandler(async (req, res) => {
    const result = await transaction((conn) => rejectTask(conn, req.user, req.params.instanceId, req.body.reason));
    await dispatchAfterCommit(result);
    ok(res, null, '已驳回');
  }));
