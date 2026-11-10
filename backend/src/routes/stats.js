/** 统计路由 */
import { Router } from 'express';
import { ok, asyncHandler } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { personalStats, deptStats } from '../services/statsService.js';

export const statsRouter = Router();
statsRouter.use(requireAuth);

/** 个人统计（口径：按提交时间；草稿不计入提交趋势） */
statsRouter.get('/personal', asyncHandler(async (req, res) => {
  ok(res, await personalStats(req.user.id));
}));

/** 部门/企业统计（权限按 stats_grants 明确授权 + 角色，见《设计文档》§11.2） */
statsRouter.get('/dept', asyncHandler(async (req, res) => {
  ok(res, await deptStats(req.user));
}));
