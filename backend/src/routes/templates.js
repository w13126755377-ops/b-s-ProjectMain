/** 员工端模板路由：可发起的已启用流程列表（按适用部门过滤） */
import { Router } from 'express';
import { query } from '../db.js';
import { ok, asyncHandler } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

/**
 * 已启用模板列表 = 三类内置流程 + 适用本人部门的自定义模板（PUBLISHED）。
 * 模板的"适用部门"限制在此过滤（服务端强制，前端隐藏仅为体验）。
 */
templatesRouter.get('/published', asyncHandler(async (req, res) => {
  const [builtin] = await query(
    `SELECT id, code, name, description, category, version
     FROM process_templates WHERE category = 'BUILTIN' AND status = 'PUBLISHED'
     ORDER BY id`
  );
  const [custom] = await query(
    `SELECT id, code, name, description, category, version, form_schema, flow_config, applicable_depts
     FROM process_templates
     WHERE category = 'CUSTOM' AND status = 'PUBLISHED'
     ORDER BY id`
  );
  // 适用部门过滤：applicable_depts 为空数组 = 全部部门；否则须包含本人部门
  const applicable = custom.filter((t) => {
    const depts = JSON.parse(t.applicable_depts || '[]');
    return depts.length === 0 || depts.includes(req.user.dept_id);
  });
  ok(res, {
    builtin: builtin.map((b) => ({ ...b, type: b.code.toUpperCase() })),
    custom: applicable.map((t) => ({
      id: t.id, code: t.code, name: t.name, description: t.description, version: t.version,
      formSchema: t.form_schema, flowConfig: t.flow_config,
      applicableDepts: JSON.parse(t.applicable_depts || '[]'),
    })),
  });
}));
