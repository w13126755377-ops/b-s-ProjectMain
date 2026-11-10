/**
 * 审批流程引擎（核心服务）：
 * - 创建草稿 / 编辑草稿 / 提交（快照+通知）/ 批准 / 驳回 / 撤回 / 催办 / 复制重提 / 删除草稿
 * - 节点审批人解析（角色规则 → 具体用户）+ 审批委托 + 快照隔离
 * - 并发与幂等：所有流转在事务内按统一锁序（applications → process_instances）加 FOR UPDATE，
 *   二次操作/并发操作得到"状态已变化"（409），只允许一方成功。
 *
 * 关键原则（对应作业要求）：
 * 1. 提交时保存本次审批路径、规则口径和人员快照，后续配置变化不自动改写已有实例
 * 2. 顺序审批：前一节点通过前，不允许后续节点审批（current_node_idx 单调推进）
 * 3. 驳回必填理由、驳回后结束；审批中可撤回；撤回与审批并发只允许一方成功
 * 4. 任何人不得审批自己的申请（提交解析 + 审批操作双重防护）
 * 5. 重复点击/网络重试/两个浏览器同时审批不能产生两次有效流转
 */
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { travelDays, parseJson } from '../utils/helpers.js';
import {
  procurementSchema, travelSchema, reimbursementSchema,
} from '../validators/applications.js';
import { validateCustomFormData } from './templateService.js';
import { createNotification, emitNotification, NOTIFY_TYPE } from './notificationService.js';
import { pushToUser } from '../utils/sse.js';

const ROLE_LABEL = {
  DEPT_HEAD: '部门负责人',
  FINANCE: '财务审批人',
  COMPANY_HEAD: '企业负责人',
};

/** 角色规则 → 具体用户（确定性口径：按用户名排序取第一个启用用户，口径写入快照） */
const ROLE_USER_SQL = {
  DEPT_HEAD:
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.code = 'DEPT_HEAD' AND u.status = 'ACTIVE' AND u.dept_id = ?
     ORDER BY u.username LIMIT 1`,
  FINANCE:
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.code = 'FINANCE' AND u.status = 'ACTIVE'
     ORDER BY u.username LIMIT 1`,
  COMPANY_HEAD:
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.code = 'COMPANY_HEAD' AND u.status = 'ACTIVE'
     ORDER BY u.username LIMIT 1`,
};

/** 查询用户当前生效的委托（提交时解析口径，见《设计文档》§14.2） */
async function findActiveDelegation(conn, userId) {
  const [rows] = await conn.execute(
    `SELECT delegatee_id FROM delegations
     WHERE user_id = ? AND enabled = 1 AND start_time <= NOW() AND end_time >= NOW()
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [userId]
  );
  return rows.length ? rows[0].delegatee_id : null;
}

/** 解析单个节点的实际审批人（含委托） */
async function resolveNodeApprover(conn, node, applicantId, applicantDeptId) {
  const rule = node.rule || {};
  let resolved = null;
  if (rule.type === 'SPECIFIED_USER') {
    const [rows] = await conn.execute('SELECT id, status FROM users WHERE id = ?', [rule.user_id]);
    if (!rows.length) {
      throw badRequest(`节点"${node.name}"指定的审批用户不存在（id=${rule.user_id}），请联系管理员修改模板`);
    }
    if (rows[0].status !== 'ACTIVE') {
      throw badRequest(`节点"${node.name}"指定的审批用户已被停用，请联系管理员修改模板`);
    }
    resolved = rows[0].id;
  } else if (ROLE_USER_SQL[rule.type]) {
    const [rows] = await conn.execute(ROLE_USER_SQL[rule.type],
      rule.type === 'DEPT_HEAD' ? [applicantDeptId] : []);
    if (!rows.length) {
      const label = ROLE_LABEL[rule.type] || rule.type;
      throw badRequest(
        rule.type === 'DEPT_HEAD'
          ? `节点"${node.name}"需要申请人部门的${label}，但该部门暂无${label}，请联系管理员授予角色`
          : `节点"${node.name}"需要${label}，但系统中暂无${label}，请联系管理员授予角色`
      );
    }
    resolved = rows[0].id;
  } else {
    throw badRequest(`节点"${node.name}"的审批人规则无效`);
  }

  // 审批委托：解析到受托人并记录 delegated_from（留痕）。
  // 安全约束：角色类节点的受托人必须持有该角色（DEPT_HEAD 还须同部门），
  // 防止财务/高金额审批权被委托给未授权员工（《设计文档》§14.2）。
  const delegatee = await findActiveDelegation(conn, resolved);
  if (delegatee !== null) {
    const [rows] = await conn.execute(
      `SELECT u.id, u.status, u.dept_id,
              (SELECT GROUP_CONCAT(r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS codes
       FROM users u WHERE u.id = ?`, [delegatee]
    );
    if (!rows.length || rows[0].status !== 'ACTIVE') {
      throw badRequest(`节点"${node.name}"的审批人委托给了不存在或已停用的用户，请检查委托配置`);
    }
    if (delegatee === applicantId) {
      throw badRequest(`节点"${node.name}"的审批委托导致审批人为申请人本人，请调整委托配置`);
    }
    const codes = (rows[0].codes || '').split(',');
    if (['FINANCE', 'COMPANY_HEAD', 'DEPT_HEAD'].includes(rule.type)) {
      if (!codes.includes(rule.type)) {
        throw badRequest(
          `节点"${node.name}"的受托人缺少${ROLE_LABEL[rule.type]}角色，无权代办该节点（委托须受托人具备相应角色）`
        );
      }
      if (rule.type === 'DEPT_HEAD' && rows[0].dept_id !== applicantDeptId) {
        throw badRequest(`节点"${node.name}"的受托人必须与申请人同部门（部门负责人审批节点）`);
      }
    }
    return { resolved_user_id: delegatee, delegated_from: resolved };
  }
  // 无有效委托时：审批人即解析到的用户本人；若为申请人本人则拒绝自审。
  if (resolved === applicantId) {
    throw badRequest(
      `节点"${node.name}"的审批人解析为申请人本人。任何人不能审批自己的申请，请先设置审批委托或联系管理员调整流程`
    );
  }
  return { resolved_user_id: resolved, delegated_from: null };
}

/** 事务内读阈值（企业负责人加签金额阈值） */
async function getThresholdForConn(conn) {
  const [rows] = await conn.execute(
    "SELECT value FROM system_configs WHERE `key` = 'company_head_threshold_cents'"
  );
  return rows.length ? Number(rows[0].value) : 10_000_000;
}

/** 构建并解析审批节点列表（提交时快照，含模板版本） */
async function buildFlow(conn, app, totalCents) {
  let nodes;
  let thresholdCents = null;
  let templateVersion = null;
  if (app.type === 'CUSTOM') {
    const [rows] = await conn.execute(
      'SELECT flow_config, version FROM process_templates WHERE id = ?', [app.template_id]
    );
    if (!rows.length) throw badRequest('流程模板不存在');
    const tpl = rows[0];
    templateVersion = tpl.version;
    nodes = JSON.parse(JSON.stringify((tpl.flow_config || {}).nodes || []));
    if (nodes.length < 2) throw badRequest('流程模板节点不完整（至少 2 个节点），请联系管理员');
  } else {
    thresholdCents = await getThresholdForConn(conn);
    nodes = [];
    if (app.type === 'PROCUREMENT') {
      nodes.push({ name: '部门负责人审批', rule: { type: 'DEPT_HEAD' } });
      nodes.push({ name: '财务预算审查', rule: { type: 'FINANCE' } });
    } else if (app.type === 'TRAVEL') {
      nodes.push({ name: '部门负责人审批', rule: { type: 'DEPT_HEAD' } });
    } else if (app.type === 'REIMBURSEMENT') {
      nodes.push({ name: '部门负责人审批', rule: { type: 'DEPT_HEAD' } });
      nodes.push({ name: '财务审核（票据）', rule: { type: 'FINANCE' } });
    } else {
      throw badRequest('未知申请类型');
    }
    if (totalCents >= thresholdCents) {
      nodes.push({ name: '企业负责人审批', rule: { type: 'COMPANY_HEAD' } });
    }
  }

  const resolvedNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    const r = await resolveNodeApprover(conn, nodes[i], app.applicant_id, app.dept_id);
    resolvedNodes.push({
      idx: i,
      name: nodes[i].name,
      rule: nodes[i].rule,
      resolved_user_id: r.resolved_user_id,
      delegated_from: r.delegated_from,
    });
  }
  // 相邻节点合并：相邻两节点解析到同一实际审批人时合并为一个节点。
  // 既避免"同一人连续审批两节点"，也从机制上杜绝双击把两个节点都审批掉（§6.5.3）。
  const merged = [];
  for (const n of resolvedNodes) {
    const prev = merged[merged.length - 1];
    if (prev && prev.resolved_user_id === n.resolved_user_id && prev.delegated_from === n.delegated_from) {
      prev.name = `${prev.name} + ${n.name}`;
      prev.rules = [...(prev.rules || [prev.rule]), n.rule];
    } else {
      merged.push({ ...n, rules: undefined });
    }
  }
  return { nodes: merged, thresholdCents, templateVersion };
}

/* ============================ 校验与归一化 ============================ */

/**
 * 从数据库重建完整提交载荷（form_data + 明细表），保证"提交时服务端重新校验"。
 */
export async function loadPayloadFromDb(conn, app) {
  const form = parseJson(app.form_data, {});
  if (app.type === 'PROCUREMENT') {
    const [items] = await conn.execute(
      `SELECT name, spec, quantity, unit, unit_price_cents AS unitPriceCents
       FROM procurement_items WHERE application_id = ? ORDER BY id`, [app.id]);
    const [quotes] = await conn.execute(
      `SELECT supplier_name AS supplierName, quote_date AS quoteDate,
              quote_amount_cents AS quoteAmountCents, quote_detail AS quoteDetail,
              purchase_link AS purchaseLink, online, attachment_ids, selected
       FROM quotations WHERE application_id = ? ORDER BY id`, [app.id]);
    return {
      ...form,
      title: app.title,
      items,
      quotations: quotes.map((q) => ({
        ...q, online: !!q.online, selected: !!q.selected,
        attachmentIds: parseJson(q.attachment_ids, []),
      })),
    };
  }
  if (app.type === 'REIMBURSEMENT') {
    const [items] = await conn.execute(
      `SELECT id, expense_type AS expenseType, occur_date AS occurDate, purpose,
              amount_cents AS amountCents, receipt_no AS receiptNo,
              no_receipt AS noReceipt, no_receipt_reason AS noReceiptReason
       FROM expense_items WHERE application_id = ? ORDER BY id`, [app.id]);
    const [recs] = await conn.execute(
      'SELECT expense_item_id, attachment_id FROM receipts WHERE application_id = ?', [app.id]);
    const byItem = new Map();
    for (const r of recs) {
      if (!byItem.has(r.expense_item_id)) byItem.set(r.expense_item_id, []);
      byItem.get(r.expense_item_id).push(r.attachment_id);
    }
    return {
      ...form,
      title: app.title,
      linkedApplicationId: app.linked_application_id || null, // 提交时回填关联申请（防丢失）
      expenseItems: items.map((it) => ({
        ...it,
        noReceipt: !!it.noReceipt,
        receiptNo: it.receiptNo || '',
        noReceiptReason: it.noReceiptReason || '',
        attachmentIds: byItem.get(it.id) || [],
      })),
    };
  }
  if (app.type === 'CUSTOM') return { formData: form };
  return form; // TRAVEL：全部字段在 form_data
}

/**
 * 校验并归一化申请载荷（创建/编辑草稿/提交共用）。
 * @param ownerId 申请人 id（校验关联申请归属）
 * @returns { formData, totalCents, items, quotations, expenseItems, receipts, warnings }
 */
export async function validateAndNormalize(conn, type, body, applicationId, templateId, ownerId) {
  let formData, totalCents, items = [], quotations = [], expenseItems = [], receipts = [];
  let linkedApplicationId = null;
  const warnings = [];

  if (type === 'PROCUREMENT') {
    const r = procurementSchema.safeParse(body);
    if (!r.success) throw badRequest('采购申请校验失败', zodErrors(r));
    const d = r.data;
    items = d.items.map((it) => ({
      ...it,
      amountCents: Math.round(it.quantity * it.unitPriceCents), // 金额由服务端重算
    }));
    quotations = d.quotations.map((q) => ({ ...q, selected: !!q.selected }));
    const selected = quotations.find((q) => q.selected);
    totalCents = selected.quoteAmountCents;
    formData = {
      reason: d.reason, expectedArrivalDate: d.expectedArrivalDate, project: d.project,
      budgetCapCents: d.budgetCapCents, remark: d.remark,
      singleSourceReason: d.singleSourceReason, selectReason: d.selectReason,
    };
  } else if (type === 'TRAVEL') {
    const r = travelSchema.safeParse(body);
    if (!r.success) throw badRequest('差旅申请校验失败', zodErrors(r));
    const d = r.data;
    const days = travelDays(d.startTime, d.endTime); // 天数由系统计算（口径：自然日-时长折算）
    totalCents = d.budgetCents;
    formData = { ...d, days, totalCents };
  } else if (type === 'REIMBURSEMENT') {
    const r = reimbursementSchema.safeParse(body);
    if (!r.success) throw badRequest('报销申请校验失败', zodErrors(r));
    const d = r.data;
    // 合计金额 = 有效费用明细金额之和（服务端重算，客户端值忽略）
    totalCents = d.expenseItems.reduce((s, it) => s + it.amountCents, 0);
    // 关联申请：必须是本人已批准的差旅或采购
    if (d.linkedApplicationId) {
      const [rows] = await conn.execute(
        'SELECT id, type, status, applicant_id FROM applications WHERE id = ?', [d.linkedApplicationId]
      );
      const la = rows[0];
      if (!la) throw badRequest('关联的申请不存在');
      if (la.applicant_id !== ownerId) throw badRequest('只能关联本人的申请');
      if (la.status !== 'APPROVED' || !['TRAVEL', 'PROCUREMENT'].includes(la.type)) {
        throw badRequest('只能关联本人已批准的差旅或采购申请');
      }
    }
    expenseItems = d.expenseItems.map((it) => ({
      expenseType: it.expenseType, occurDate: it.occurDate, purpose: it.purpose,
      amountCents: it.amountCents, receiptNo: it.receiptNo.trim(),
      noReceipt: !!it.noReceipt, noReceiptReason: it.noReceiptReason,
    }));
    receipts = [];
    d.expenseItems.forEach((it, i) => {
      it.attachmentIds.forEach((attId) => {
        receipts.push({ itemIdx: i, attachmentId: attId, receiptNo: it.receiptNo.trim() || null });
      });
    });
    formData = {
      description: d.description, remark: d.remark,
    };
    linkedApplicationId = d.linkedApplicationId || null;
    // 跨申请重复票据预警（增强功能）：警告不阻断
    if (applicationId) {
      warnings.push(...(await crossFormReceiptWarnings(conn, applicationId, expenseItems, receipts)));
    }
  } else if (type === 'CUSTOM') {
    if (!templateId) throw badRequest('自定义申请必须指定流程模板');
    const [rows] = await conn.execute(
      'SELECT * FROM process_templates WHERE id = ? AND status = "PUBLISHED"', [templateId]
    );
    if (!rows.length) throw badRequest('流程模板不存在或未启用');
    const tpl = rows[0];
    const v = validateCustomFormData(tpl.form_schema, body.formData || {});
    if (!v.ok) throw badRequest('表单校验失败', v.errors);
    formData = v.parsed;
    totalCents = 0;
    // 附件字段收集（用于归属校验）
    const tplFields = (tpl.form_schema || {}).fields || [];
    for (const f of tplFields) {
      if (f.type === 'attachment' && Array.isArray(formData[f.id])) {
        receipts = receipts.concat(formData[f.id].map((id) => ({ attachmentId: id, customField: f.id })));
      }
    }
  } else {
    throw badRequest('未知申请类型');
  }

  // 附件归属校验：所有引用的附件必须已上传到本申请（防跨单盗用附件 id）
  if (applicationId) {
    const allIds = [
      ...quotations.flatMap((q) => q.attachmentIds || []),
      ...(Array.isArray(formData.attachmentIds) ? formData.attachmentIds : []),
      ...receipts.map((x) => x.attachmentId),
    ];
    if (allIds.length) {
      const [rows] = await conn.execute(
        `SELECT id FROM attachments WHERE application_id = ? AND id IN (${allIds.map(() => '?').join(',')})`,
        [applicationId, ...allIds]
      );
      const found = new Set(rows.map((x) => x.id));
      const missing = allIds.filter((x) => !found.has(x));
      if (missing.length) throw badRequest(`引用了不存在的附件（id=${missing.join(',')}），请重新上传`);
    }
  }
  return { formData, totalCents, items, quotations, expenseItems, receipts, warnings, linkedApplicationId };
}

/** 跨申请重复票据预警：同票据号或同文件 MD5 出现在其他报销单中（警告不阻断） */
async function crossFormReceiptWarnings(conn, applicationId, expenseItems, receipts) {
  const attIds = receipts.map((r) => r.attachmentId);
  const nos = expenseItems.filter((e) => e.receiptNo).map((e) => e.receiptNo);
  if (!attIds.length && !nos.length) return [];
  const noPlaceholders = nos.map(() => '?').join(',') || "''";
  const attPlaceholders = attIds.map(() => '?').join(',') || '0';
  const [rows] = await conn.execute(
    `SELECT DISTINCT a.app_no, a.title, u.name AS applicant_name, r.receipt_no, att.original_name
     FROM receipts r
     JOIN expense_items e ON e.id = r.expense_item_id
     JOIN applications a ON a.id = e.application_id
     JOIN attachments att ON att.id = r.attachment_id
     JOIN users u ON u.id = a.applicant_id
     WHERE a.id <> ? AND a.type = 'REIMBURSEMENT'
       AND ((r.receipt_no IS NOT NULL AND r.receipt_no IN (${noPlaceholders}))
            OR att.md5 IN (SELECT md5 FROM attachments WHERE id IN (${attPlaceholders})))`,
    [applicationId, ...nos, ...attIds]
  );
  return rows.map((x) => ({
    appNo: x.app_no, title: x.title, applicantName: x.applicant_name,
    receiptNo: x.receipt_no, fileName: x.original_name,
  }));
}

function zodErrors(r) {
  return r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/* ============================ 明细存取 ============================ */

/** 保存明细表（删除重建，事务内） */
async function saveDetails(conn, applicationId, data) {
  if (data.type === 'PROCUREMENT') {
    await conn.execute('DELETE FROM procurement_items WHERE application_id = ?', [applicationId]);
    for (const it of data.items) {
      await conn.execute(
        `INSERT INTO procurement_items (application_id, name, spec, quantity, unit, unit_price_cents, amount_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [applicationId, it.name, it.spec, it.quantity, it.unit, it.unitPriceCents, it.amountCents]
      );
    }
    await conn.execute('DELETE FROM quotations WHERE application_id = ?', [applicationId]);
    for (const q of data.quotations) {
      await conn.execute(
        `INSERT INTO quotations (application_id, supplier_name, quote_date, quote_amount_cents,
           quote_detail, purchase_link, online, attachment_ids, selected, is_single_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [applicationId, q.supplierName, q.quoteDate, q.quoteAmountCents, q.quoteDetail,
         q.purchaseLink, q.online ? 1 : 0, JSON.stringify(q.attachmentIds || []), q.selected ? 1 : 0,
         data.formData.singleSourceReason ? 1 : 0]
      );
    }
  } else if (data.type === 'REIMBURSEMENT') {
    await conn.execute('DELETE FROM receipts WHERE application_id = ?', [applicationId]);
    await conn.execute('DELETE FROM expense_items WHERE application_id = ?', [applicationId]);
    const itemIdOf = [];
    for (const it of data.expenseItems) {
      const [res] = await conn.execute(
        `INSERT INTO expense_items (application_id, expense_type, occur_date, purpose, amount_cents,
           receipt_no, no_receipt, no_receipt_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [applicationId, it.expenseType, it.occurDate, it.purpose, it.amountCents,
         it.receiptNo || null, it.noReceipt ? 1 : 0, it.noReceiptReason || null]
      );
      itemIdOf.push(res.insertId);
    }
    for (const r of data.receipts) {
      await conn.execute(
        `INSERT INTO receipts (application_id, expense_item_id, attachment_id, receipt_no)
         VALUES (?, ?, ?, ?)`,
        [applicationId, itemIdOf[r.itemIdx], r.attachmentId, r.receiptNo || null]
      );
    }
  }
}

/** 报销票据附件必须是 RECEIPT 类型（通过票据上传入口上传），且同单内不得复用同一文件（MD5） */
export async function ensureReceiptAttachments(conn, applicationId, receipts) {
  const ids = receipts.map((r) => r.attachmentId);
  if (!ids.length) return;
  const [rows] = await conn.execute(
    `SELECT id, biz_type, md5 FROM attachments WHERE application_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [applicationId, ...ids]
  );
  const map = new Map(rows.map((r) => [r.id, r]));
  const md5Seen = new Map(); // md5 -> 首次使用的附件 id
  for (const r of receipts) {
    const att = map.get(r.attachmentId);
    if (!att) throw badRequest(`票据附件不存在（id=${r.attachmentId}）`);
    if (att.biz_type !== 'RECEIPT') throw badRequest('票据文件必须通过票据上传入口上传');
    if (md5Seen.has(att.md5) && md5Seen.get(att.md5) !== att.id) {
      throw badRequest('同一张票据（文件内容相同）不能在同一报销单内重复使用');
    }
    md5Seen.set(att.md5, att.id);
  }
}

/* ============================ 创建 / 编辑 / 提交 ============================ */

/** 创建申请行（草稿），生成唯一编号。payload = {title, formData, linkedApplicationId?} */
export async function createApplicationRow(conn, user, type, templateId, payload, sourceId = null) {
  const { generateAppNo } = await import('../utils/appNo.js');
  const appNo = await generateAppNo(conn, type);
  const [res] = await conn.execute(
    `INSERT INTO applications (app_no, type, template_id, applicant_id, dept_id,
       title, form_data, status, total_amount_cents, source_application_id, linked_application_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', 0, ?, ?, NOW())`,
    [appNo, type, templateId, user.id, user.dept_id, payload.title,
     JSON.stringify(payload.formData), sourceId, payload.linkedApplicationId || null]
  );
  return res.insertId;
}

/**
 * 创建草稿或直接提交（路由层调用，包事务）。
 * 提交时先落草稿再走提交流程，保证校验失败时草稿仍可编辑。
 */
export async function createApplication(conn, user, type, templateId, body, submitNow) {
  // 先做一次校验（不校验附件归属——草稿刚创建还没有附件）
  const data = await validateAndNormalize(conn, type, body, null, templateId, user.id);
  const appId = await createApplicationRow(conn, user, type, templateId, {
    title: body.title,
    formData: data.formData,
    linkedApplicationId: data.linkedApplicationId,
  });
  await saveDetails(conn, appId, { type, ...data });
  if (submitNow) {
    return { appId, submit: await submitApplication(conn, user, appId) };
  }
  return { appId };
}

/** 编辑草稿（校验 + 重建明细） */
export async function updateDraft(conn, user, applicationId, body) {
  const [rows] = await conn.execute(
    'SELECT * FROM applications WHERE id = ? AND applicant_id = ? FOR UPDATE',
    [applicationId, user.id]
  );
  if (!rows.length) throw notFound('申请不存在');
  const app = rows[0];
  if (app.status !== 'DRAFT') throw conflict('只有草稿可以编辑');

  const data = await validateAndNormalize(conn, app.type, body, applicationId, app.template_id, user.id);
  const [upd] = await conn.execute(
    `UPDATE applications SET title = ?, form_data = ?, total_amount_cents = ?, linked_application_id = ?, updated_at = NOW()
     WHERE id = ? AND status = 'DRAFT'`,
    [body.title, JSON.stringify(data.formData), data.totalCents, data.linkedApplicationId, applicationId]
  );
  if (upd.affectedRows === 0) throw conflict('该申请状态已变化，请刷新后重试');
  await saveDetails(conn, applicationId, { type: app.type, ...data });
  return { warnings: data.warnings };
}

/** 提交申请：状态机 DRAFT → IN_APPROVAL（条件更新防双击双提交） */
export async function submitApplication(conn, user, applicationId) {
  const [appRows] = await conn.execute(
    'SELECT * FROM applications WHERE id = ? AND applicant_id = ? FOR UPDATE',
    [applicationId, user.id]
  );
  if (!appRows.length) throw notFound('申请不存在');
  const app = appRows[0];
  if (app.status !== 'DRAFT') throw conflict('该申请已提交，不能重复提交');

  // 部门归属须经管理员确认后方可提交（《设计文档》§2.2-4）
  const [applicant] = await conn.execute(
    'SELECT dept_confirmed FROM users WHERE id = ?', [app.applicant_id]
  );
  if (!applicant.length || !applicant[0].dept_confirmed) {
    throw badRequest('您的部门归属尚未经管理员确认，请先联系管理员在用户管理中确认后再提交申请');
  }

  // 从数据库重建完整载荷 → 服务端最终校验（金额重算、附件归属、关联申请、跨单重复票据预警）
  const body = await loadPayloadFromDb(conn, app);
  const data = await validateAndNormalize(conn, app.type, body, applicationId, app.template_id, user.id);
  if (app.type === 'REIMBURSEMENT') {
    // 提交时完整性校验：每条非无票支出必须至少关联 1 份票据（草稿阶段允许暂缺，见《设计文档》§7）
    const receiptCountByItem = new Map();
    for (const rc of data.receipts) receiptCountByItem.set(rc.itemIdx, (receiptCountByItem.get(rc.itemIdx) || 0) + 1);
    data.expenseItems.forEach((it, i) => {
      if (!it.noReceipt && !receiptCountByItem.get(i)) {
        throw badRequest(`费用明细第 ${i + 1} 条（${it.expenseType}）需至少关联 1 份票据，或标记为无票支出`);
      }
    });
    await ensureReceiptAttachments(conn, applicationId, data.receipts);
  }

  // 构建并快照审批路径（人员解析 + 委托 + 阈值 + 模板版本）
  const { nodes, thresholdCents, templateVersion } = await buildFlow(conn, app, data.totalCents);

  const [upd] = await conn.execute(
    `UPDATE applications
     SET status = 'IN_APPROVAL', form_data = ?, total_amount_cents = ?,
         linked_application_id = ?, template_version = ?, submitted_at = NOW(), finished_at = NULL
     WHERE id = ? AND status = 'DRAFT'`,
    [JSON.stringify(data.formData), data.totalCents, data.linkedApplicationId, templateVersion, applicationId]
  );
  if (upd.affectedRows === 0) throw conflict('该申请已提交（请勿重复操作）');

  await saveDetails(conn, applicationId, { type: app.type, ...data });

  const [instRes] = await conn.execute(
    `INSERT INTO process_instances
       (application_id, template_id, template_version, flow_snapshot, current_node_idx,
        current_approver_id, status, total_amount_cents, submitted_at)
     VALUES (?, ?, ?, ?, 0, ?, 'IN_APPROVAL', ?, NOW())`,
    [applicationId, app.template_id, templateVersion,
     JSON.stringify({ nodes, thresholdCents, builtin: app.type !== 'CUSTOM' }),
     nodes[0].resolved_user_id, data.totalCents]
  );
  const instanceId = instRes.insertId;
  await conn.execute('UPDATE applications SET current_instance_id = ? WHERE id = ?', [instanceId, applicationId]);

  await conn.execute(
    `INSERT INTO approval_records (instance_id, application_id, node_idx, node_name, approver_user_id, acted_by, action, comment, result)
     VALUES (?, ?, -1, '提交申请', NULL, ?, 'SUBMIT', ?, NULL)`,
    [instanceId, applicationId, user.id, body.title ? '' : '']
  );

  // 通知：新待办 → 第一个节点审批人（biz_key 唯一防重）
  const notifies = [];
  const first = nodes[0];
  const inserted = await createNotification({
    userId: first.resolved_user_id,
    type: NOTIFY_TYPE.TODO,
    title: `新的审批待办：${app.title}`,
    content: `申请人 ${user.name} 提交了申请，请及时审批`,
    link: `/apps/${applicationId}`,
    bizKey: `TODO:inst:${instanceId}:node:0:user:${first.resolved_user_id}`,
  }, conn);
  if (inserted) {
    notifies.push({
      userId: first.resolved_user_id, type: NOTIFY_TYPE.TODO,
      title: `新的审批待办：${app.title}`,
      content: `申请人 ${user.name} 提交了申请，请及时审批`,
      link: `/apps/${applicationId}`,
    });
  }
  return {
    instanceId, applicationId, notifies,
    refreshUsers: [user.id, first.resolved_user_id],
    warnings: data.warnings,
  };
}

/* ============================ 审批 / 驳回 ============================ */

/** 批准当前节点 */
export async function approveTask(conn, user, instanceId, comment = '') {
  return handleTaskAction(conn, user, instanceId, 'APPROVE', comment);
}

/** 驳回当前节点（理由必填，路由层校验） */
export async function rejectTask(conn, user, instanceId, reason) {
  return handleTaskAction(conn, user, instanceId, 'REJECT', reason);
}

/**
 * 统一锁序：applications → process_instances（与撤回一致，避免死锁）。
 */
async function handleTaskAction(conn, user, instanceId, action, comment) {
  // 1) 先无锁读取定位申请 id
  const [peek] = await conn.execute('SELECT application_id FROM process_instances WHERE id = ?', [instanceId]);
  if (!peek.length) throw notFound('待办不存在');
  const appId = peek[0].application_id;

  // 2) 锁申请行（统一锁序第一顺位）
  const [appRows] = await conn.execute('SELECT * FROM applications WHERE id = ? FOR UPDATE', [appId]);
  const app = appRows[0];
  if (!app || app.status !== 'IN_APPROVAL') throw conflict('该申请状态已变化，请刷新后重试');

  // 3) 锁实例行（统一锁序第二顺位），并重读最新状态
  const [instRows] = await conn.execute('SELECT * FROM process_instances WHERE id = ? FOR UPDATE', [instanceId]);
  if (!instRows.length) throw notFound('待办不存在');
  const inst = instRows[0];
  if (inst.status !== 'IN_APPROVAL') throw conflict('该申请流程已结束（可能已被他人处理）');

  const nodes = (inst.flow_snapshot || {}).nodes || [];
  const node = nodes[inst.current_node_idx];
  if (!node) throw conflict('流程数据异常，请联系管理员');
  if (node.resolved_user_id !== user.id) throw forbidden('只有当前节点的审批人可以处理该待办');
  if (app.applicant_id === user.id) throw forbidden('任何人不能审批自己的申请');

  const notifies = [];
  const refreshUsers = [app.applicant_id, user.id];

  if (action === 'APPROVE') {
    const nextIdx = inst.current_node_idx + 1;
    const isLast = nextIdx >= nodes.length;
    if (isLast) {
      await conn.execute(
        `UPDATE process_instances SET status = 'APPROVED', finished_at = NOW(), current_approver_id = NULL
         WHERE id = ? AND status = 'IN_APPROVAL'`,
        [instanceId]
      );
      await conn.execute(
        `UPDATE applications SET status = 'APPROVED', finished_at = NOW()
         WHERE id = ? AND status = 'IN_APPROVAL'`,
        [appId]
      );
    } else {
      await conn.execute(
        `UPDATE process_instances SET current_node_idx = ?, current_approver_id = ?
         WHERE id = ? AND status = 'IN_APPROVAL'`,
        [nextIdx, nodes[nextIdx].resolved_user_id, instanceId]
      );
    }
    await conn.execute(
      `INSERT INTO approval_records (instance_id, application_id, node_idx, node_name, approver_user_id, acted_by, action, comment, result)
       VALUES (?, ?, ?, ?, ?, ?, 'APPROVE', ?, 'PASS')`,
      [instanceId, appId, inst.current_node_idx, node.name, node.resolved_user_id, user.id, comment]
    );
    if (isLast) {
      const ins = await createNotification({
        userId: app.applicant_id, type: NOTIFY_TYPE.APPROVED,
        title: `申请已通过：${app.title}`,
        content: '恭喜，您的申请已全部审批通过',
        link: `/apps/${appId}`,
        bizKey: `APPROVED:app:${appId}:user:${app.applicant_id}`,
      }, conn);
      if (ins) notifies.push({
        userId: app.applicant_id, type: NOTIFY_TYPE.APPROVED,
        title: `申请已通过：${app.title}`, content: '恭喜，您的申请已全部审批通过',
        link: `/apps/${appId}`,
      });
    } else {
      const next = nodes[nextIdx];
      const ins = await createNotification({
        userId: next.resolved_user_id, type: NOTIFY_TYPE.TODO,
        title: `新的审批待办：${app.title}`,
        content: `${user.name} 已通过上一节点审批，请及时处理`,
        link: `/apps/${appId}`,
        bizKey: `TODO:inst:${instanceId}:node:${nextIdx}:user:${next.resolved_user_id}`,
      }, conn);
      if (ins) notifies.push({
        userId: next.resolved_user_id, type: NOTIFY_TYPE.TODO,
        title: `新的审批待办：${app.title}`,
        content: `${user.name} 已通过上一节点审批，请及时处理`,
        link: `/apps/${appId}`,
      });
      refreshUsers.push(next.resolved_user_id);
    }
  } else {
    // REJECT：驳回必填理由，驳回后结束本次审批
    await conn.execute(
      `UPDATE process_instances SET status = 'REJECTED', finished_at = NOW(), current_approver_id = NULL
       WHERE id = ? AND status = 'IN_APPROVAL'`,
      [instanceId]
    );
    await conn.execute(
      `UPDATE applications SET status = 'REJECTED', finished_at = NOW()
       WHERE id = ? AND status = 'IN_APPROVAL'`,
      [appId]
    );
    await conn.execute(
      `INSERT INTO approval_records (instance_id, application_id, node_idx, node_name, approver_user_id, acted_by, action, comment, result)
       VALUES (?, ?, ?, ?, ?, ?, 'REJECT', ?, 'REJECT')`,
      [instanceId, appId, inst.current_node_idx, node.name, node.resolved_user_id, user.id, comment]
    );
    const ins = await createNotification({
      userId: app.applicant_id, type: NOTIFY_TYPE.REJECTED,
      title: `申请被驳回：${app.title}`,
      content: `驳回理由：${comment}`,
      link: `/apps/${appId}`,
      bizKey: `REJECTED:app:${appId}:user:${app.applicant_id}`,
    }, conn);
    if (ins) notifies.push({
      userId: app.applicant_id, type: NOTIFY_TYPE.REJECTED,
      title: `申请被驳回：${app.title}`, content: `驳回理由：${comment}`,
      link: `/apps/${appId}`,
    });
  }
  return { instanceId, applicationId: appId, notifies, refreshUsers, appNo: app.app_no, title: app.title };
}

/* ============================ 撤回 / 催办 / 复制 / 删除 ============================ */

/** 申请人撤回（审批中）。与审批并发时仅一方成功（行锁串行化 + 状态条件更新） */
export async function withdrawApplication(conn, user, applicationId) {
  const [appRows] = await conn.execute(
    'SELECT * FROM applications WHERE id = ? AND applicant_id = ? FOR UPDATE',
    [applicationId, user.id]
  );
  if (!appRows.length) throw notFound('申请不存在');
  const app = appRows[0];
  if (app.status !== 'IN_APPROVAL') throw conflict('只有审批中的申请可以撤回');

  const [instRows] = await conn.execute(
    'SELECT * FROM process_instances WHERE application_id = ? AND status = "IN_APPROVAL" FOR UPDATE',
    [applicationId]
  );
  if (!instRows.length) throw conflict('该申请已被处理，无法撤回（状态已变化）');
  const inst = instRows[0];

  await conn.execute(
    `UPDATE applications SET status = 'WITHDRAWN', finished_at = NOW()
     WHERE id = ? AND status = 'IN_APPROVAL'`,
    [applicationId]
  );
  await conn.execute(
    `UPDATE process_instances SET status = 'WITHDRAWN', finished_at = NOW(), current_approver_id = NULL
     WHERE id = ? AND status = 'IN_APPROVAL'`,
    [inst.id]
  );
  const nodes = (inst.flow_snapshot || {}).nodes || [];
  const cur = nodes[inst.current_node_idx];
  await conn.execute(
    `INSERT INTO approval_records (instance_id, application_id, node_idx, node_name, approver_user_id, acted_by, action, comment, result)
     VALUES (?, ?, ?, ?, ?, ?, 'WITHDRAW', '申请人撤回', 'WITHDRAW')`,
    [inst.id, applicationId, inst.current_node_idx, cur ? cur.name : '', cur ? cur.resolved_user_id : null, user.id]
  );

  const notifies = [];
  if (cur) {
    const ins = await createNotification({
      userId: cur.resolved_user_id, type: NOTIFY_TYPE.WITHDRAWN,
      title: `申请被撤回：${app.title}`,
      content: `申请人 ${user.name} 撤回了该申请，原待办已失效`,
      link: `/apps/${applicationId}`,
      bizKey: `WITHDRAWN:app:${applicationId}:user:${cur.resolved_user_id}`,
    }, conn);
    if (ins) notifies.push({
      userId: cur.resolved_user_id, type: NOTIFY_TYPE.WITHDRAWN,
      title: `申请被撤回：${app.title}`, content: `申请人 ${user.name} 撤回了该申请，原待办已失效`,
      link: `/apps/${applicationId}`,
    });
  }
  return { applicationId, notifies, refreshUsers: [user.id, ...(cur ? [cur.resolved_user_id] : [])] };
}

/** 催办：向当前审批人发提醒（每节点限 1 次，biz_key 防刷） */
export async function remindApplication(conn, user, applicationId) {
  const [appRows] = await conn.execute(
    'SELECT * FROM applications WHERE id = ? AND applicant_id = ? FOR UPDATE',
    [applicationId, user.id]
  );
  if (!appRows.length) throw notFound('申请不存在');
  const app = appRows[0];
  if (app.status !== 'IN_APPROVAL') throw conflict('只有审批中的申请可以催办');

  const [instRows] = await conn.execute(
    'SELECT * FROM process_instances WHERE application_id = ? AND status = "IN_APPROVAL" FOR UPDATE',
    [applicationId]
  );
  if (!instRows.length) throw conflict('申请状态已变化');
  const inst = instRows[0];
  const nodes = (inst.flow_snapshot || {}).nodes || [];
  const cur = nodes[inst.current_node_idx];

  const inserted = await createNotification({
    userId: cur.resolved_user_id, type: NOTIFY_TYPE.REMIND,
    title: `催办提醒：${app.title}`,
    content: `申请人 ${user.name} 提醒您尽快处理该申请`,
    link: `/apps/${applicationId}`,
    bizKey: `REMIND:inst:${inst.id}:node:${inst.current_node_idx}:user:${cur.resolved_user_id}`,
  }, conn);
  if (!inserted) throw conflict('该节点已催办过，请耐心等待审批人处理');
  return {
    applicationId,
    notifies: [{
      userId: cur.resolved_user_id, type: NOTIFY_TYPE.REMIND,
      title: `催办提醒：${app.title}`,
      content: `申请人 ${user.name} 提醒您尽快处理该申请`,
      link: `/apps/${applicationId}`,
    }],
    refreshUsers: [cur.resolved_user_id],
  };
}

/** 复制重提（驳回/撤回后）：新申请 + 新编号，source_application_id 关联原单 */
export async function copyApplication(conn, user, applicationId) {
  const [appRows] = await conn.execute(
    'SELECT * FROM applications WHERE id = ? AND applicant_id = ?', [applicationId, user.id]
  );
  if (!appRows.length) throw notFound('申请不存在');
  const app = appRows[0];
  if (!['REJECTED', 'WITHDRAWN'].includes(app.status)) {
    throw conflict('只有已驳回或已撤回的申请可以复制重提');
  }
  const newId = await createApplicationRow(conn, user, app.type, app.template_id, {
    title: `${app.title}（重新提交）`,
    formData: parseJson(app.form_data, {}),
    linkedApplicationId: app.linked_application_id || null,
  }, applicationId);

  if (app.type === 'PROCUREMENT') {
    const [items] = await conn.execute('SELECT * FROM procurement_items WHERE application_id = ?', [applicationId]);
    for (const it of items) {
      await conn.execute(
        `INSERT INTO procurement_items (application_id, name, spec, quantity, unit, unit_price_cents, amount_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId, it.name, it.spec, it.quantity, it.unit, it.unit_price_cents, it.amount_cents]
      );
    }
    const [quotes] = await conn.execute('SELECT * FROM quotations WHERE application_id = ?', [applicationId]);
    for (const q of quotes) {
      await conn.execute(
        `INSERT INTO quotations (application_id, supplier_name, quote_date, quote_amount_cents,
           quote_detail, purchase_link, online, attachment_ids, selected, is_single_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId, q.supplier_name, q.quote_date, q.quote_amount_cents, q.quote_detail,
         q.purchase_link, q.online, q.attachment_ids, 0, q.is_single_source]
      );
    }
  } else if (app.type === 'REIMBURSEMENT') {
    const [items] = await conn.execute('SELECT * FROM expense_items WHERE application_id = ?', [applicationId]);
    const idMap = {};
    for (const it of items) {
      const [res] = await conn.execute(
        `INSERT INTO expense_items (application_id, expense_type, occur_date, purpose, amount_cents, receipt_no, no_receipt, no_receipt_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId, it.expense_type, it.occur_date, it.purpose, it.amount_cents, it.receipt_no, it.no_receipt, it.no_receipt_reason]
      );
      idMap[it.id] = res.insertId;
    }
    const [recs] = await conn.execute('SELECT * FROM receipts WHERE application_id = ?', [applicationId]);
    for (const r of recs) {
      await conn.execute(
        'INSERT INTO receipts (application_id, expense_item_id, attachment_id, receipt_no) VALUES (?, ?, ?, ?)',
        [newId, idMap[r.expense_item_id], r.attachment_id, r.receipt_no]
      );
    }
  }
  // 克隆附件行（共享物理文件，MD5 不变 → 跨单重复票据检测依然有效）
  const [atts] = await conn.execute(
    'SELECT biz_type, original_name, stored_name, mime, size_bytes, md5 FROM attachments WHERE application_id = ?',
    [applicationId]
  );
  for (const a of atts) {
    await conn.execute(
      `INSERT INTO attachments (application_id, biz_type, original_name, stored_name, mime, size_bytes, md5, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, a.biz_type, a.original_name, a.stored_name, a.mime, a.size_bytes, a.md5, user.id]
    );
  }
  return newId;
}

/** 删除草稿（仅草稿；返回物理文件名列表，由调用方在引用归零后删除文件） */
export async function deleteDraft(conn, user, applicationId) {
  const [rows] = await conn.execute(
    'SELECT * FROM applications WHERE id = ? AND applicant_id = ? FOR UPDATE',
    [applicationId, user.id]
  );
  if (!rows.length) throw notFound('申请不存在');
  if (rows[0].status !== 'DRAFT') throw conflict('只有草稿可以删除');

  const [files] = await conn.execute(
    'SELECT stored_name FROM attachments WHERE application_id = ?', [applicationId]
  );
  await conn.execute('DELETE FROM applications WHERE id = ?', [applicationId]); // 明细/实例/日志/附件行级联删除
  return files.map((f) => f.stored_name);
}

/* ============================ 通知派发（事务提交后调用） ============================ */

/** 事务提交后的通知派发（SSE + Web Push + 列表刷新事件） */
export async function dispatchAfterCommit(result) {
  if (!result) return;
  const notifyList = result.notifies || [];
  for (const n of notifyList) {
    await emitNotification(n.userId, n);
  }
  const refreshUsers = [...new Set(result.refreshUsers || [])];
  for (const uid of refreshUsers) {
    pushToUser(uid, 'refresh', { scope: 'all' });
  }
}
