/**
 * 查询统计服务。
 * 口径（界面与文档明确标注）：
 * - 按"提交时间 submitted_at"统计；
 * - 已通过金额 = status='APPROVED' 的申请的 total_amount_cents 之和；
 * - 草稿、驳回、撤回金额一律不计入已通过金额。
 * 权限：
 * - 个人统计：本人；
 * - 部门统计：DEPT_HEAD（本部门）、FINANCE（授权的财务统计：报销+采购）、
 *   COMPANY_HEAD / ADMIN（全部部门全部类型）。
 */
import { forbidden } from '../errors.js';
import { query } from '../db.js';
import { ROLE } from '../middleware/auth.js';

/** 近 6 个月月份桶（YYYY-MM），由 SQL 生成 */
const MONTH_BUCKETS = `
  (SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL m MONTH), '%Y-%m') AS ym
   FROM (SELECT 0 m UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) t)`;

/** 个人统计 */
export async function personalStats(userId) {
  const [statusRows] = await query(
    `SELECT status, COUNT(*) AS c FROM applications WHERE applicant_id = ? GROUP BY status`,
    [userId]
  );
  const byStatus = { DRAFT: 0, IN_APPROVAL: 0, APPROVED: 0, REJECTED: 0, WITHDRAWN: 0 };
  for (const r of statusRows) byStatus[r.status] = r.c;

  const [todo] = await query(
    `SELECT COUNT(*) AS c FROM process_instances WHERE status = 'IN_APPROVAL' AND current_approver_id = ?`,
    [userId]
  );
  const [done] = await query(
    `SELECT COUNT(DISTINCT application_id) AS c FROM approval_records
     WHERE acted_by = ? AND action IN ('APPROVE','REJECT')`,
    [userId]
  );
  // 近 6 个月提交趋势（草稿不计入——口径按提交时间）
  const [trend] = await query(
    `SELECT b.ym, COALESCE(t.c, 0) AS c
     FROM ${MONTH_BUCKETS} b
     LEFT JOIN (
       SELECT DATE_FORMAT(submitted_at, '%Y-%m') AS ym, COUNT(*) AS c
       FROM applications
       WHERE applicant_id = ? AND submitted_at IS NOT NULL
       GROUP BY ym
     ) t ON t.ym = b.ym
     ORDER BY b.ym`,
    [userId]
  );
  return {
    byStatus,
    total: Object.values(byStatus).reduce((s, v) => s + v, 0),
    todoCount: todo[0].c,
    doneCount: done[0].c,
    monthlySubmitted: trend,
  };
}

/**
 * 部门/企业统计（按"明确授权"定范围，见 stats_grants 表）：
 * - DEPT_HEAD：本部门（角色自带，对应"查询本部门审批情况"）
 * - FINANCE：须 stats_grants 授予 FINANCE 口径（报销+采购，全部部门）
 * - COMPANY_HEAD：须 stats_grants 授予 COMPANY 口径（全部部门全部类型），不因角色自动获得
 * - ADMIN：全部（管理职责）
 */
export async function deptStats(user) {
  let deptFilter = null;      // null = 全部部门
  let typeFilter = null;      // null = 全部类型
  const { roleCodes, dept_id, id } = user;
  const isAdmin = roleCodes.includes(ROLE.ADMIN);
  const isHead = roleCodes.includes(ROLE.DEPT_HEAD);

  if (!isAdmin && !isHead && !roleCodes.includes(ROLE.FINANCE) && !roleCodes.includes(ROLE.COMPANY_HEAD)) {
    throw forbidden('没有权限查看部门统计');
  }

  if (isAdmin) {
    // 全部范围
  } else if (isHead) {
    deptFilter = dept_id; // 部门负责人：本部门
  } else {
    // FINANCE / COMPANY_HEAD：必须查授权记录（明确授权）
    const [grants] = await query(
      'SELECT scope FROM stats_grants WHERE user_id = ?', [id]
    );
    const scopes = grants.map((g) => g.scope);
    const wantFinance = roleCodes.includes(ROLE.FINANCE) && !roleCodes.includes(ROLE.COMPANY_HEAD);
    const wantCompany = roleCodes.includes(ROLE.COMPANY_HEAD);
    if (wantFinance && scopes.includes('FINANCE')) {
      typeFilter = ['REIMBURSEMENT', 'PROCUREMENT']; // 授权的财务统计口径
    } else if (wantCompany && scopes.includes('COMPANY')) {
      // 全部部门全部类型
    } else {
      throw forbidden('企业范围/财务统计需管理员明确授权（管理后台 → 统计授权）');
    }
  }

  const where = ['1=1'];
  const params = [];
  if (deptFilter) { where.push('a.dept_id = ?'); params.push(deptFilter); }
  if (typeFilter) { where.push('a.type IN (?, ?)'); params.push(...typeFilter); }
  const w = where.join(' AND ');

  // 各类型数量与状态分布（按提交时间口径：仅统计已提交）
  const [byType] = await query(
    `SELECT a.type, a.status, COUNT(*) AS c
     FROM applications a
     WHERE ${w} AND a.submitted_at IS NOT NULL
     GROUP BY a.type, a.status`,
    params
  );
  // 已通过金额（草稿/驳回/撤回不计入），按部门
  const [amountByDept] = await query(
    `SELECT d.id AS dept_id, d.name AS dept_name, COALESCE(SUM(a.total_amount_cents), 0) AS approved_cents, COUNT(a.id) AS approved_count
     FROM departments d
     LEFT JOIN applications a ON a.dept_id = d.id AND a.status = 'APPROVED' AND a.submitted_at IS NOT NULL
       ${typeFilter ? 'AND a.type IN (?, ?)' : ''}
       ${deptFilter ? 'AND d.id = ?' : ''}
     GROUP BY d.id, d.name
     ORDER BY approved_cents DESC`,
    [...(typeFilter || []), ...(deptFilter ? [deptFilter] : [])]
  );
  // 近 6 个月已通过金额趋势（口径：提交时间）
  const [trend] = await query(
    `SELECT b.ym, COALESCE(t.approved_cents, 0) AS approved_cents, COALESCE(t.c, 0) AS c
     FROM ${MONTH_BUCKETS} b
     LEFT JOIN (
       SELECT DATE_FORMAT(a.submitted_at, '%Y-%m') AS ym,
              SUM(a.total_amount_cents) AS approved_cents, COUNT(*) AS c
       FROM applications a
       WHERE a.status = 'APPROVED' AND a.submitted_at IS NOT NULL ${w ? `AND ${w}` : ''}
       GROUP BY ym
     ) t ON t.ym = b.ym
     ORDER BY b.ym`,
    params
  );
  // 部门列表（供筛选展示）
  const [depts] = await query('SELECT id, name FROM departments ORDER BY id');
  return { byType, amountByDept, trend, departments: depts, scope: { deptFilter, typeFilter } };
}
