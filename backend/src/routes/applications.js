/** 申请路由（三类业务 + 自定义统一入口） */
import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { query, transaction } from '../db.js';
import { badRequest, ok, asyncHandler } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createApplication, updateDraft, submitApplication, withdrawApplication,
  remindApplication, copyApplication, deleteDraft, dispatchAfterCommit,
} from '../services/approvalService.js';
import { listMyApplications, getApplicationForDetail, buildApplicationDetail } from '../services/applicationService.js';
import { config } from '../config.js';

export const applicationsRouter = Router();
applicationsRouter.use(requireAuth);

const listQuerySchema = z.object({
  type: z.enum(['PROCUREMENT', 'TRAVEL', 'REIMBURSEMENT', 'CUSTOM']).optional(),
  status: z.enum(['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  keyword: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

/** 我的申请列表（类型/状态/时间/关键词筛选 + 分页） */
applicationsRouter.get('/', validate({ query: listQuerySchema }), asyncHandler(async (req, res) => {
  ok(res, await listMyApplications(req.user, req.query));
}));

const createSchema = z.object({
  type: z.enum(['PROCUREMENT', 'TRAVEL', 'REIMBURSEMENT', 'CUSTOM']),
  templateId: z.number().int().positive().optional(),
  title: z.string().trim().min(1, '标题不能为空').max(100),
  submit: z.boolean().optional().default(false),
}).passthrough(); // 各类型专属字段由服务层 zod 校验

/** 创建草稿（或直接提交）。申请人/部门/时间一律取服务端会话。 */
applicationsRouter.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  const { type, templateId, title, submit, ...rest } = req.body;
  const result = await transaction(async (conn) => {
    if (type === 'CUSTOM' && !templateId) throw badRequest('自定义申请必须指定流程模板');
    return createApplication(conn, req.user, type, templateId || null, { title, ...rest }, submit);
  });
  if (submit && result.submit) {
    await dispatchAfterCommit(result.submit);
    ok(res, { id: result.appId, warnings: result.submit.warnings }, '提交成功');
  } else {
    ok(res, { id: result.appId, warnings: [] }, '草稿已保存');
  }
}));

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

/** 申请详情（权限：申请人本人或审批链成员） */
applicationsRouter.get('/:id', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { app, instance } = await getApplicationForDetail(req.user, req.params.id);
  ok(res, await buildApplicationDetail(req.user, app, instance));
}));

/** 编辑草稿 */
applicationsRouter.patch('/:id', validate({ params: idParamSchema, body: createSchema.omit({ type: true, submit: true, templateId: true }) }), asyncHandler(async (req, res) => {
  const { title, ...rest } = req.body;
  const result = await transaction((conn) => updateDraft(conn, req.user, req.params.id, { title, ...rest }));
  ok(res, { warnings: result.warnings }, '草稿已更新');
}));

/** 提交（校验 + 快照 + 通知） */
applicationsRouter.post('/:id/submit', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const result = await transaction((conn) => submitApplication(conn, req.user, req.params.id));
  await dispatchAfterCommit(result);
  ok(res, { warnings: result.warnings }, '提交成功，进入审批流程');
}));

/** 撤回（审批中） */
applicationsRouter.post('/:id/withdraw', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const result = await transaction((conn) => withdrawApplication(conn, req.user, req.params.id));
  await dispatchAfterCommit(result);
  ok(res, null, '已撤回');
}));

/** 催办（当前节点，每节点限 1 次） */
applicationsRouter.post('/:id/remind', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const result = await transaction((conn) => remindApplication(conn, req.user, req.params.id));
  await dispatchAfterCommit(result);
  ok(res, null, '已催办');
}));

/** 复制重提（驳回/撤回后生成新申请） */
applicationsRouter.post('/:id/copy', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const newId = await transaction((conn) => copyApplication(conn, req.user, req.params.id));
  ok(res, { id: newId }, '已复制为新草稿，请修改后重新提交');
}));

/** 删除草稿（物理文件引用归零后删除） */
applicationsRouter.delete('/:id', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const storedNames = await transaction((conn) => deleteDraft(conn, req.user, req.params.id));
  for (const name of storedNames) {
    const refs = await query('SELECT COUNT(*) AS c FROM attachments WHERE stored_name = ?', [name]);
    if (refs[0].c === 0) {
      await fs.unlink(path.join(config.upload.dir, name)).catch(() => {});
    }
  }
  ok(res, null, '草稿已删除');
}));
