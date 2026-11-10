/**
 * 申请/待办查询服务。
 * 数据范围在 SQL 层强制：本人申请；详情仅申请人本人或审批链中的节点审批人可见。
 * 系统管理员不默认获得业务正文/票据查看权（管理权限 ≠ 审批权限，另行走审批链授权）。
 */
import { forbidden, notFound } from '../errors.js';
import { query } from '../db.js';

/** 我的申请列表（筛选 + 分页） */
export async function listMyApplications(user, f) {
  const where = ['a.applicant_id = ?'];
  const params = [user.id];
  if (f.type) { where.push('a.type = ?'); params.push(f.type); }
  if (f.status) { where.push('a.status = ?'); params.push(f.status); }
  if (f.dateFrom) { where.push('a.created_at >= ?'); params.push(`${f.dateFrom} 00:00:00`); }
  if (f.dateTo) { where.push('a.created_at <= ?'); params.push(`${f.dateTo} 23:59:59`); }
  if (f.keyword) { where.push('(a.title LIKE ? OR a.app_no LIKE ?)'); params.push(`%${f.keyword}%`, `%${f.keyword}%`); }
  const page = Math.max(1, Number(f.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(f.pageSize || 10)));
  const [countRows] = await query(
    `SELECT COUNT(*) AS c FROM applications a WHERE ${where.join(' AND ')}`, params);
  const total = countRows[0].c;
  const [rows] = await query(
    `SELECT a.id, a.app_no, a.type, a.title, a.status, a.total_amount_cents,
            a.submitted_at, a.created_at, a.finished_at, a.source_application_id,
            pi.current_approver_id, u.name AS current_approver_name
     FROM applications a
     LEFT JOIN process_instances pi ON pi.id = a.current_instance_id
     LEFT JOIN users u ON u.id = pi.current_approver_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]);
  return { list: rows, total, page, pageSize };
}

/** 我是否在该申请的审批链中（节点审批人或受托人） */
export function isInApprovalChain(userId, instance) {
  const nodes = (instance && instance.flow_snapshot && instance.flow_snapshot.nodes) || [];
  return nodes.some((n) => n.resolved_user_id === userId || n.delegated_from === userId);
}

/** 详情可见性：申请人本人，或审批链中的审批人 */
export function assertCanViewApplication(user, app, instance) {
  if (app.applicant_id === user.id) return;
  if (instance && isInApprovalChain(user.id, instance)) return;
  throw forbidden('没有权限查看该申请');
}

/** 我的待办 / 已办 */
export async function listTasks(user, scope) {
  if (scope === 'todo') {
    const [rows] = await query(
      `SELECT pi.id AS instance_id, pi.application_id, pi.current_node_idx, pi.status AS inst_status,
              pi.flow_snapshot, pi.submitted_at,
              a.app_no, a.type, a.title, a.status AS app_status, a.total_amount_cents,
              applicant.name AS applicant_name
       FROM process_instances pi
       JOIN applications a ON a.id = pi.application_id
       JOIN users applicant ON applicant.id = a.applicant_id
       WHERE pi.status = 'IN_APPROVAL' AND pi.current_approver_id = ?
       ORDER BY pi.submitted_at ASC`,
      [user.id]
    );
    return rows.map((r) => {
      const nodes = (r.flow_snapshot || {}).nodes || [];
      const cur = nodes[r.current_node_idx] || {};
      return {
        instance_id: r.instance_id, application_id: r.application_id,
        app_no: r.app_no, type: r.type, title: r.title, status: r.app_status,
        total_amount_cents: r.total_amount_cents, applicant_name: r.applicant_name,
        submitted_at: r.submitted_at,
        current_node: { idx: r.current_node_idx, name: cur.name || '' },
        is_delegated: cur.delegated_from != null,
      };
    });
  }
  // 已办：我作为操作人处理过的审批记录（批准/驳回）
  const [rows] = await query(
    `SELECT DISTINCT a.id AS application_id, a.app_no, a.type, a.title, a.status,
            a.total_amount_cents, a.finished_at, a.submitted_at,
            applicant.name AS applicant_name,
            (SELECT ar.action FROM approval_records ar
             WHERE ar.application_id = a.id AND ar.acted_by = ?
               AND ar.action IN ('APPROVE','REJECT')
             ORDER BY ar.id DESC LIMIT 1) AS my_action,
            (SELECT ar.comment FROM approval_records ar
             WHERE ar.application_id = a.id AND ar.acted_by = ?
               AND ar.action IN ('APPROVE','REJECT')
             ORDER BY ar.id DESC LIMIT 1) AS my_comment
     FROM applications a
     JOIN approval_records ar2 ON ar2.application_id = a.id AND ar2.acted_by = ?
     JOIN users applicant ON applicant.id = a.applicant_id
     WHERE ar2.action IN ('APPROVE','REJECT')
     ORDER BY a.id DESC`,
    [user.id, user.id, user.id]
  );
  return rows;
}

/** 申请详情组装（权限校验通过后调用） */
export async function buildApplicationDetail(user, app, instance) {
  const detail = {
    ...app,
    applicant: null,
    instance: null,
    records: [],
    items: [], quotations: [], expenseItems: [], attachments: [],
    template: null, linkedApplication: null, sourceApplicationNo: null,
    duplicateWarnings: [],
  };

  // 申请人信息
  const [users] = await query(
    `SELECT u.id, u.name, u.username, d.name AS dept_name
     FROM users u LEFT JOIN departments d ON d.id = u.dept_id WHERE u.id = ?`,
    [app.applicant_id]
  );
  detail.applicant = users[0] || null;

  // 审批链人员名称
  const userIds = new Set();
  if (instance) {
    for (const n of ((instance.flow_snapshot || {}).nodes || [])) {
      if (n.resolved_user_id) userIds.add(n.resolved_user_id);
      if (n.delegated_from) userIds.add(n.delegated_from);
    }
  }
  const nameMap = new Map();
  if (userIds.size) {
    const [urows] = await query(
      `SELECT id, name FROM users WHERE id IN (${[...userIds].map(() => '?').join(',')})`,
      [...userIds]
    );
    urows.forEach((u) => nameMap.set(u.id, u.name));
  }

  if (instance) {
    const nodes = ((instance.flow_snapshot || {}).nodes || []).map((n) => ({
      ...n,
      resolved_name: nameMap.get(n.resolved_user_id) || null,
      delegated_from_name: n.delegated_from ? (nameMap.get(n.delegated_from) || null) : null,
    }));
    detail.instance = {
      id: instance.id,
      status: instance.status,
      current_node_idx: instance.current_node_idx,
      current_approver_id: instance.current_approver_id,
      submitted_at: instance.submitted_at,
      finished_at: instance.finished_at,
      threshold_cents: (instance.flow_snapshot || {}).thresholdCents ?? null,
      nodes,
    };
    const [records] = await query(
      `SELECT ar.node_idx, ar.node_name, ar.action, ar.comment, ar.result, ar.created_at,
              ar.approver_user_id, ar.acted_by, u.name AS acted_by_name
       FROM approval_records ar
       LEFT JOIN users u ON u.id = ar.acted_by
       WHERE ar.application_id = ?
       ORDER BY ar.id ASC`,
      [app.id]
    );
    detail.records = records;
  }

  // 类型明细
  if (app.type === 'PROCUREMENT') {
    const [items] = await query('SELECT * FROM procurement_items WHERE application_id = ? ORDER BY id', [app.id]);
    detail.items = items;
    const [quotes] = await query('SELECT * FROM quotations WHERE application_id = ? ORDER BY id', [app.id]);
    detail.quotations = quotes.map((q) => ({ ...q, attachmentIds: JSON.parse(q.attachment_ids || '[]') }));
  } else if (app.type === 'REIMBURSEMENT') {
    const [items] = await query('SELECT * FROM expense_items WHERE application_id = ? ORDER BY id', [app.id]);
    const [recs] = await query('SELECT * FROM receipts WHERE application_id = ?', [app.id]);
    const recMap = new Map();
    for (const r of recs) {
      if (!recMap.has(r.expense_item_id)) recMap.set(r.expense_item_id, []);
      recMap.get(r.expense_item_id).push(r);
    }
    detail.expenseItems = items.map((it) => ({
      ...it, receipts: recMap.get(it.id) || [],
    }));
    // 关联申请摘要（获批差旅/采购信息展示，独立列 linked_application_id）
    if (app.linked_application_id) {
      const [la] = await query(
        `SELECT a.id, a.app_no, a.title, a.type, a.form_data, a.total_amount_cents
         FROM applications a WHERE a.id = ?`,
        [app.linked_application_id]
      );
      detail.linkedApplication = la[0] || null;
    }
    // 跨申请重复票据预警（财务审核界面突出显示）
    detail.duplicateWarnings = await computeDuplicateWarnings(app);
  }

  // 附件列表（含票据）
  const [atts] = await query(
    'SELECT id, biz_type, original_name, mime, size_bytes, uploaded_at FROM attachments WHERE application_id = ? ORDER BY id',
    [app.id]
  );
  detail.attachments = atts;

  // 复制重提来源
  if (app.source_application_id) {
    const [src] = await query('SELECT app_no FROM applications WHERE id = ?', [app.source_application_id]);
    detail.sourceApplicationNo = src[0] ? src[0].app_no : null;
  }

  // 自定义模板 schema（前端动态渲染）
  if (app.type === 'CUSTOM') {
    const [tpl] = await query(
      'SELECT name, form_schema, flow_config, version FROM process_templates WHERE id = ? AND version = ?',
      [app.template_id, app.template_version]
    );
    if (!tpl.length) {
      // 版本行可能已被清理的兜底：取同 id 任意版本
      const [anyTpl] = await query('SELECT name, form_schema, version FROM process_templates WHERE id = ? LIMIT 1', [app.template_id]);
      detail.template = anyTpl[0] || null;
    } else {
      detail.template = tpl[0];
    }
  }
  return detail;
}

/** 跨申请重复票据预警（详情页/财务审核实时计算） */
export async function computeDuplicateWarnings(app) {
  if (app.type !== 'REIMBURSEMENT') return [];
  const [rows] = await query(
    `SELECT a.app_no, a.title, u.name AS applicant_name, r.receipt_no, att.original_name
     FROM receipts r
     JOIN expense_items e ON e.id = r.expense_item_id
     JOIN applications a ON a.id = e.application_id
     JOIN attachments att ON att.id = r.attachment_id
     JOIN users u ON u.id = a.applicant_id
     WHERE a.id <> ? AND a.type = 'REIMBURSEMENT'
       AND ((r.receipt_no IS NOT NULL AND r.receipt_no IN
              (SELECT DISTINCT receipt_no FROM receipts WHERE application_id = ? AND receipt_no IS NOT NULL))
            OR att.md5 IN
              (SELECT md5 FROM attachments WHERE id IN
                (SELECT attachment_id FROM receipts WHERE application_id = ?)))
     LIMIT 20`,
    [app.id, app.id, app.id]
  );
  return rows;
}

/** 辅助：详情入口（路由使用） */
export async function getApplicationForDetail(user, id) {
  const [rows] = await query(
    `SELECT a.*, u.name AS applicant_name,
            d.name AS dept_name
     FROM applications a
     JOIN users u ON u.id = a.applicant_id
     LEFT JOIN departments d ON d.id = a.dept_id
     WHERE a.id = ?`,
    [id]
  );
  if (!rows.length) throw notFound('申请不存在');
  const app = rows[0];
  app.form_data = app.form_data ? JSON.parse(app.form_data) : {};
  let instance = null;
  if (app.current_instance_id) {
    const [inst] = await query('SELECT * FROM process_instances WHERE id = ?', [app.current_instance_id]);
    instance = inst[0] || null;
    if (instance && instance.flow_snapshot) {
      instance.flow_snapshot = typeof instance.flow_snapshot === 'string'
        ? JSON.parse(instance.flow_snapshot) : instance.flow_snapshot;
    }
  }
  assertCanViewApplication(user, app, instance);
  return { app, instance };
}
