/**
 * 管理后台路由（/api/admin/*，全部 requireAdmin）。
 * 管理员配置与授权变更一律写 audit_logs（留痕）。
 * 注意：管理权限 ≠ 审批权限——业务正文/票据访问不随 ADMIN 角色开放（见 attachments.js）。
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { badRequest, conflict, notFound, ok, asyncHandler } from '../errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { validateForPublish, checkSpecifiedUsers } from '../services/templateService.js';
import { deptStats } from '../services/statsService.js';
import { parseJson } from '../utils/helpers.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

/** 审计留痕 */
async function writeAudit(connOrNull, operatorId, action, targetType, targetId, detail) {
  const db = connOrNull || { execute: (sql, p) => query(sql, p) };
  await db.execute(
    `INSERT INTO audit_logs (operator_id, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [operatorId, action, targetType, targetId, JSON.stringify(detail)]
  );
}

/* ================= 用户管理 ================= */

const usersQuerySchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  deptId: z.coerce.number().int().positive().optional(),
  roleId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

adminRouter.get('/users', validate({ query: usersQuerySchema }), asyncHandler(async (req, res) => {
  const { keyword, deptId, roleId, page = 1, pageSize = 10 } = req.query;
  const where = ['1=1'];
  const params = [];
  if (keyword) { where.push('(u.username LIKE ? OR u.name LIKE ? OR u.email LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  if (deptId) { where.push('u.dept_id = ?'); params.push(deptId); }
  if (roleId) { where.push('u.id IN (SELECT user_id FROM user_roles WHERE role_id = ?)'); params.push(roleId); }
  const countRows = await query(`SELECT COUNT(*) AS c FROM users u WHERE ${where.join(' AND ')}`, params);
  const rows = await query(
    `SELECT u.id, u.username, u.email, u.name, u.dept_id, u.dept_confirmed, u.status, u.created_at,
            d.name AS dept_name,
            (SELECT GROUP_CONCAT(CONCAT(r.id, ':', r.code, ':', r.name) SEPARATOR '|')
             FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles
     FROM users u LEFT JOIN departments d ON d.id = u.dept_id
     WHERE ${where.join(' AND ')} ORDER BY u.id LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  ok(res, {
    list: rows.map((r) => ({
      ...r,
      roles: r.roles ? r.roles.split('|').map((s) => {
        const [id, code, name] = s.split(':');
        return { id: Number(id), code, name };
      }) : [],
    })),
    total: countRows[0].c, page, pageSize,
  });
}));

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(32).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  deptId: z.number().int().positive().optional(),
  deptConfirmed: z.boolean().optional(),
});

/** 更新用户（启停/改部门/确认部门归属），全部留痕 */
adminRouter.patch('/users/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: updateUserSchema }), asyncHandler(async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) throw notFound('用户不存在');
  const { name, status, deptId, deptConfirmed } = req.body;
  const sets = [];
  const params = [];
  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (status !== undefined) { sets.push('status = ?'); params.push(status); }
  if (deptId !== undefined) {
    const dept = await queryOne('SELECT id FROM departments WHERE id = ?', [deptId]);
    if (!dept) throw badRequest('部门不存在');
    sets.push('dept_id = ?'); params.push(deptId);
    await writeAudit(null, req.user.id, 'CHANGE_DEPT', 'USER', user.id, { from: user.dept_id, to: deptId });
  }
  if (deptConfirmed === true) {
    sets.push('dept_confirmed = 1');
    await writeAudit(null, req.user.id, 'CONFIRM_DEPT', 'USER', user.id, { dept_id: deptId || user.dept_id });
  }
  if (!sets.length) throw badRequest('没有需要修改的内容');
  if (status !== undefined) {
    await writeAudit(null, req.user.id, status === 'ACTIVE' ? 'ENABLE_USER' : 'DISABLE_USER', 'USER', user.id, {});
  }
  params.push(req.params.id);
  await query(`UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  ok(res, null, '已更新');
}));

/** 授/撤角色（客户端不能指定自身角色；此处由管理员授予并留痕） */
adminRouter.put('/users/:id/roles', validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ roleIds: z.array(z.number().int().positive()).max(10) }) }), asyncHandler(async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) throw notFound('用户不存在');
  const roleIds = [...new Set(req.body.roleIds)];
  const valid = await query(`SELECT id FROM roles WHERE id IN (${roleIds.map(() => '?').join(',') || '0'})`, roleIds);
  if (valid.length !== roleIds.length) throw badRequest('存在无效角色');
  const before = await query('SELECT role_id FROM user_roles WHERE user_id = ?', [req.params.id]);
  const beforeIds = before.map((r) => r.role_id);
  await query('DELETE FROM user_roles WHERE user_id = ?', [req.params.id]);
  for (const rid of roleIds) {
    await query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [req.params.id, rid]);
  }
  await writeAudit(null, req.user.id, 'GRANT_ROLE', 'USER', req.params.id, { before: beforeIds, after: roleIds });
  ok(res, null, '角色已更新');
}));

/* ================= 部门管理 ================= */

adminRouter.get('/departments', asyncHandler(async (_req, res) => {
  ok(res, await query('SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.dept_id = d.id) AS user_count FROM departments d ORDER BY d.id'));
}));

const deptSchema = z.object({ name: z.string().trim().min(1, '部门名称不能为空').max(50), description: z.string().trim().max(200).optional().default('') });

adminRouter.post('/departments', validate({ body: deptSchema }), asyncHandler(async (req, res) => {
  try {
    const r = await query('INSERT INTO departments (name, description, created_at) VALUES (?, ?, NOW())',
      [req.body.name, req.body.description]);
    await writeAudit(null, req.user.id, 'CREATE_DEPT', 'DEPARTMENT', r.insertId, { name: req.body.name });
    ok(res, { id: r.insertId }, '部门已创建');
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') throw conflict('部门名称已存在');
    throw err;
  }
}));

adminRouter.patch('/departments/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: deptSchema }), asyncHandler(async (req, res) => {
  const d = await queryOne('SELECT * FROM departments WHERE id = ?', [req.params.id]);
  if (!d) throw notFound('部门不存在');
  await query('UPDATE departments SET name = ?, description = ? WHERE id = ?',
    [req.body.name, req.body.description, req.params.id]);
  await writeAudit(null, req.user.id, 'UPDATE_DEPT', 'DEPARTMENT', req.params.id, { name: req.body.name });
  ok(res, null, '部门已更新');
}));

adminRouter.delete('/departments/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), asyncHandler(async (req, res) => {
  const users = await query('SELECT COUNT(*) AS c FROM users WHERE dept_id = ?', [req.params.id]);
  if (users[0].c > 0) throw conflict('该部门下还有用户，不能删除（请先调整用户部门）');
  await query('DELETE FROM departments WHERE id = ?', [req.params.id]);
  await writeAudit(null, req.user.id, 'DELETE_DEPT', 'DEPARTMENT', req.params.id, {});
  ok(res, null, '部门已删除');
}));

/* ================= 流程模板管理 ================= */

const templateSchema = z.object({
  name: z.string().trim().min(1, '模板名称不能为空').max(100),
  description: z.string().trim().max(300).optional().default(''),
  applicableDepts: z.array(z.number().int().positive()).max(50).optional().default([]),
  formSchema: z.object({ fields: z.array(z.any()).min(1, '至少需要 1 个表单字段') }),
  flowConfig: z.object({ nodes: z.array(z.any()) }),
});

function normalizeTemplate(body) {
  return {
    name: body.name,
    description: body.description,
    applicable_depts: JSON.stringify(body.applicableDepts || []),
    form_schema: JSON.stringify(body.formSchema),
    flow_config: JSON.stringify(body.flowConfig),
  };
}

adminRouter.get('/templates', asyncHandler(async (_req, res) => {
  const rows = await query('SELECT * FROM process_templates ORDER BY category, id');
  ok(res, rows.map((t) => ({
    id: t.id, code: t.code, name: t.name, description: t.description, category: t.category,
    version: t.version, status: t.status,
    applicableDepts: parseJson(t.applicable_depts, []),
    formSchema: t.form_schema, flowConfig: t.flow_config,
    createdBy: t.created_by, createdAt: t.created_at, updatedAt: t.updated_at,
  })));
}));

adminRouter.post('/templates', validate({ body: templateSchema }), asyncHandler(async (req, res) => {
  const t = normalizeTemplate(req.body);
  const r = await query(
    `INSERT INTO process_templates (code, name, description, category, applicable_depts, form_schema, flow_config, version, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'CUSTOM', ?, ?, ?, 1, 'DRAFT', ?, NOW(), NOW())`,
    [`custom_${crypto.randomUUID().slice(0, 8)}`, t.name, t.description, t.applicable_depts, t.form_schema, t.flow_config, req.user.id]
  );
  await writeAudit(null, req.user.id, 'CREATE_TEMPLATE', 'TEMPLATE', r.insertId, { name: t.name });
  ok(res, { id: r.insertId }, '模板草稿已创建');
}));

/** 编辑：DRAFT 原位修改；PUBLISHED/DISABLED 生成新版本草稿（version+1） */
adminRouter.put('/templates/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: templateSchema }), asyncHandler(async (req, res) => {
  const tpl = await queryOne('SELECT * FROM process_templates WHERE id = ?', [req.params.id]);
  if (!tpl) throw notFound('模板不存在');
  if (tpl.category === 'BUILTIN') throw badRequest('内置流程模板不可编辑');
  const t = normalizeTemplate(req.body);
  let targetId = tpl.id;
  if (tpl.status !== 'DRAFT') {
    // 新版本草稿
    const max = await query('SELECT MAX(version) AS v FROM process_templates WHERE code = ?', [tpl.code]);
    const r = await query(
      `INSERT INTO process_templates (code, name, description, category, applicable_depts, form_schema, flow_config, version, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'CUSTOM', ?, ?, ?, ?, 'DRAFT', ?, NOW(), NOW())`,
      [tpl.code, t.name, t.description, t.applicable_depts, t.form_schema, t.flow_config, (max[0].v || 0) + 1, req.user.id]
    );
    targetId = r.insertId;
    await writeAudit(null, req.user.id, 'CREATE_TEMPLATE', 'TEMPLATE', targetId, { name: t.name, fromVersion: tpl.id });
  } else {
    await query(
      `UPDATE process_templates SET name = ?, description = ?, applicable_depts = ?, form_schema = ?, flow_config = ?, updated_at = NOW()
       WHERE id = ?`,
      [t.name, t.description, t.applicable_depts, t.form_schema, t.flow_config, tpl.id]
    );
  }
  ok(res, { id: targetId }, '模板已保存');
}));

/** 发布（§8.4 校验：字段标识唯一、条件引用有效、节点完整、审批人规则有效、适用部门合法） */
adminRouter.post('/templates/:id/publish', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), asyncHandler(async (req, res) => {
  const tpl = await queryOne('SELECT * FROM process_templates WHERE id = ?', [req.params.id]);
  if (!tpl) throw notFound('模板不存在');
  if (tpl.category === 'BUILTIN') throw badRequest('内置流程模板不可发布');
  const errors = [
    ...validateForPublish({
      form_schema: tpl.form_schema, flow_config: tpl.flow_config,
    }),
    ...(await checkSpecifiedUsers({ flow_config: tpl.flow_config })),
  ];
  // 适用部门合法性
  const deptIds = parseJson(tpl.applicable_depts, []);
  if (deptIds.length) {
    const depts = await query(`SELECT id FROM departments WHERE id IN (${deptIds.map(() => '?').join(',')})`, deptIds);
    if (depts.length !== deptIds.length) errors.push('适用部门包含不存在的部门');
  }
  if (errors.length) throw badRequest(`发布校验未通过：\n${errors.join('；\n')}`);
  await query(
    `UPDATE process_templates SET status = 'PUBLISHED', updated_at = NOW() WHERE id = ?`, [tpl.id]
  );
  // 同 code 其他 PUBLISHED 版本自动停用（保留版本历史）
  await query(
    `UPDATE process_templates SET status = 'DISABLED' WHERE code = ? AND id <> ? AND status = 'PUBLISHED'`,
    [tpl.code, tpl.id]
  );
  await writeAudit(null, req.user.id, 'PUBLISH_TEMPLATE', 'TEMPLATE', tpl.id, { version: tpl.version });
  ok(res, null, '模板已发布并启用');
}));

/** 启用/停用 */
adminRouter.post('/templates/:id/toggle', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), asyncHandler(async (req, res) => {
  const tpl = await queryOne('SELECT * FROM process_templates WHERE id = ?', [req.params.id]);
  if (!tpl) throw notFound('模板不存在');
  if (tpl.category === 'BUILTIN') throw badRequest('内置流程模板不可停用');
  if (!['PUBLISHED', 'DISABLED'].includes(tpl.status)) throw badRequest('草稿状态不可启用/停用');
  const next = tpl.status === 'PUBLISHED' ? 'DISABLED' : 'PUBLISHED';
  await query('UPDATE process_templates SET status = ?, updated_at = NOW() WHERE id = ?', [next, tpl.id]);
  await writeAudit(null, req.user.id, next === 'PUBLISHED' ? 'ENABLE_TEMPLATE' : 'DISABLE_TEMPLATE', 'TEMPLATE', tpl.id, {});
  ok(res, null, next === 'PUBLISHED' ? '模板已启用' : '模板已停用');
}));

/* ================= 系统配置 ================= */

const ALLOWED_CONFIG_KEYS = new Set([
  'company_head_threshold_cents', 'receipt_max_count', 'receipt_max_total_mb',
  'receipt_max_size_mb', 'remind_timeout_hours',
]);

adminRouter.get('/config', asyncHandler(async (_req, res) => {
  const rows = await query('SELECT `key`, value, description FROM system_configs ORDER BY `key`');
  ok(res, rows);
}));

adminRouter.patch('/config', validate({ body: z.object({
  company_head_threshold_cents: z.number().int().nonnegative().max(1e12).optional(),
  receipt_max_count: z.number().int().min(1).max(100).optional(),
  receipt_max_total_mb: z.number().int().min(1).max(1000).optional(),
  receipt_max_size_mb: z.number().int().min(1).max(50).optional(),
  remind_timeout_hours: z.number().min(0).max(8760).optional(),
}).strict() }), asyncHandler(async (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) continue;
    const before = await queryOne('SELECT value FROM system_configs WHERE `key` = ?', [key]);
    await query('UPDATE system_configs SET value = ? WHERE `key` = ?', [String(value), key]);
    await writeAudit(null, req.user.id, 'UPDATE_CONFIG', 'CONFIG', key, { before: before ? before.value : null, after: String(value) });
  }
  ok(res, null, '配置已更新');
}));

/* ================= 统计授权（明确授权机制） ================= */

adminRouter.get('/stats-grants', asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT g.id, g.user_id, u.name AS user_name, u.username, g.scope, g.created_at, granter.name AS granted_by_name
     FROM stats_grants g
     JOIN users u ON u.id = g.user_id
     LEFT JOIN users granter ON granter.id = g.granted_by
     ORDER BY g.id DESC`
  );
  ok(res, rows);
}));

adminRouter.post('/stats-grants', validate({ body: z.object({
  userId: z.number().int().positive(),
  scope: z.enum(['FINANCE', 'COMPANY']),
}) }), asyncHandler(async (req, res) => {
  const u = await queryOne('SELECT id FROM users WHERE id = ?', [req.body.userId]);
  if (!u) throw badRequest('用户不存在');
  const exists = await queryOne(
    'SELECT id FROM stats_grants WHERE user_id = ? AND scope = ?', [req.body.userId, req.body.scope]
  );
  if (exists) throw conflict('该授权已存在');
  const r = await query(
    'INSERT INTO stats_grants (user_id, scope, granted_by, created_at) VALUES (?, ?, ?, NOW())',
    [req.body.userId, req.body.scope, req.user.id]
  );
  await writeAudit(null, req.user.id, 'GRANT_STATS', 'USER', req.body.userId, { scope: req.body.scope });
  ok(res, { id: r.insertId }, '统计授权已授予');
}));

adminRouter.delete('/stats-grants/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), asyncHandler(async (req, res) => {
  const g = await queryOne('SELECT * FROM stats_grants WHERE id = ?', [req.params.id]);
  if (!g) throw notFound('授权记录不存在');
  await query('DELETE FROM stats_grants WHERE id = ?', [req.params.id]);
  await writeAudit(null, req.user.id, 'REVOKE_STATS', 'USER', g.user_id, { scope: g.scope });
  ok(res, null, '授权已收回');
}));

/* ================= 审计日志 / 全公司统计 ================= */

const auditQuerySchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

adminRouter.get('/audit-logs', validate({ query: auditQuerySchema }), asyncHandler(async (req, res) => {
  const { keyword, page = 1, pageSize = 20 } = req.query;
  const where = keyword ? '(al.action LIKE ? OR al.target_type LIKE ?)' : '1=1';
  const params = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];
  const countRows = await query(`SELECT COUNT(*) AS c FROM audit_logs al WHERE ${where}`, params);
  const rows = await query(
    `SELECT al.id, al.action, al.target_type, al.target_id, al.detail, al.created_at,
            u.name AS operator_name, u.username AS operator_username
     FROM audit_logs al LEFT JOIN users u ON u.id = al.operator_id
     WHERE ${where} ORDER BY al.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  ok(res, { list: rows, total: countRows[0].c, page, pageSize });
}));

adminRouter.get('/stats', asyncHandler(async (req, res) => {
  ok(res, await deptStats(req.user));
}));

adminRouter.get('/roles', asyncHandler(async (_req, res) => {
  ok(res, await query('SELECT id, code, name FROM roles ORDER BY id'));
}));
