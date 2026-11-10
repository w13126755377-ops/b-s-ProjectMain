/**
 * 自定义流程模板服务：
 * - 发布前校验（字段标识唯一、条件引用有效、节点完整、审批人规则有效、无循环）
 * - 按 form_schema 动态构建 zod 校验器（自定义申请提交时使用）
 */
import { z } from 'zod';
import { badRequest } from '../errors.js';
import { queryOne } from '../db.js';

export const NODE_RULE_TYPES = ['DEPT_HEAD', 'FINANCE', 'COMPANY_HEAD', 'SPECIFIED_USER'];
export const FIELD_TYPES = ['text', 'textarea', 'number', 'amount', 'date', 'radio', 'attachment'];
const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * 发布前校验。返回错误列表（空数组 = 通过）。
 * 规则见《设计文档》§8.4
 */
export function validateForPublish(template) {
  const errors = [];
  const schema = template.form_schema || { fields: [] };
  const flow = template.flow_config || { nodes: [] };
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];

  // 1. 表单字段校验
  const ids = new Set();
  for (const f of fields) {
    if (!f.id || !FIELD_ID_RE.test(f.id)) {
      errors.push(`字段标识非法或缺失（应为小写字母开头的字母数字下划线）：${f.id || '(空)'}`);
    } else if (ids.has(f.id)) {
      errors.push(`字段标识重复：${f.id}`);
    }
    ids.add(f.id);
    if (!f.label || !String(f.label).trim()) errors.push(`字段 "${f.id}" 缺少名称`);
    if (!FIELD_TYPES.includes(f.type)) errors.push(`字段 "${f.id}" 类型无效：${f.type}`);
    if (f.type === 'radio' && (!Array.isArray(f.options) || f.options.length < 2)) {
      errors.push(`单选字段 "${f.id}" 至少需要 2 个选项`);
    }
    if ((f.type === 'number' || f.type === 'amount') && f.rules) {
      if (f.rules.min !== undefined && f.rules.max !== undefined && Number(f.rules.min) > Number(f.rules.max)) {
        errors.push(`字段 "${f.id}" 的最小值大于最大值`);
      }
    }
    // 条件引用
    if (f.condition) {
      const ref = f.condition.field;
      if (!ref) {
        errors.push(`字段 "${f.id}" 的条件缺少引用字段`);
      } else if (!ids.has(ref)) {
        errors.push(`字段 "${f.id}" 的条件引用了不存在的字段：${ref}`);
      }
      if (!['eq', 'neq', 'gt', 'lt', 'in'].includes(f.condition.op)) {
        errors.push(`字段 "${f.id}" 的条件运算符无效：${f.condition.op}`);
      }
    }
  }
  // 2. 条件引用无循环（显隐依赖链不能成环）
  for (const f of fields) {
    if (!f.condition) continue;
    const chain = [f.id];
    let cur = f.condition.field;
    while (cur && ids.has(cur)) {
      if (chain.includes(cur)) {
        errors.push(`字段条件引用存在循环依赖：${chain.join(' → ')} → ${cur}`);
        break;
      }
      chain.push(cur);
      const target = fields.find((x) => x.id === cur);
      cur = target && target.condition ? target.condition.field : null;
      if (chain.length > 50) { errors.push('条件引用链过长'); break; }
    }
  }

  // 3. 节点校验
  if (nodes.length < 2) {
    errors.push('审批节点至少需要 2 个（可调整顺序）');
  } else {
    const nodeNames = new Set();
    for (const n of nodes) {
      if (!n.name || !String(n.name).trim()) errors.push('存在缺少名称的审批节点');
      else if (nodeNames.has(n.name.trim())) errors.push(`审批节点名称重复：${n.name}`);
      nodeNames.add(n.name && n.name.trim());
      if (!n.rule || !NODE_RULE_TYPES.includes(n.rule.type)) {
        errors.push(`节点 "${n.name}" 的审批人规则无效`);
      } else if (n.rule.type === 'SPECIFIED_USER' && !Number.isInteger(n.rule.user_id)) {
        errors.push(`节点 "${n.name}" 需要指定审批用户`);
      }
    }
  }
  return errors;
}

/**
 * 发布时校验指定用户规则引用的用户存在且启用（异步 DB 检查）
 */
export async function checkSpecifiedUsers(template) {
  const nodes = (template.flow_config || {}).nodes || [];
  const errors = [];
  for (const n of nodes) {
    if (n.rule && n.rule.type === 'SPECIFIED_USER') {
      const u = await queryOne(
        'SELECT id, username, status FROM users WHERE id = ?',
        [n.rule.user_id]
      );
      if (!u) errors.push(`节点 "${n.name}" 指定的用户不存在（id=${n.rule.user_id}）`);
      else if (u.status !== 'ACTIVE') errors.push(`节点 "${n.name}" 指定的用户已停用：${u.username}`);
    }
  }
  return errors;
}

/**
 * 按模板 form_schema 动态构建 zod 校验器。
 * 条件显隐：被隐藏字段的必填校验自动跳过（与前端一致）。
 */
export function buildCustomFormValidator(schema) {
  const fields = (schema && schema.fields) || [];
  const shape = {};
  for (const f of fields) {
    shape[f.id] = fieldToZod(f);
  }
  const base = z.object(shape).strict(); // 拒绝未定义字段
  // 附加条件校验：可见性判断在调用方基于提交值计算后，此处仅保证类型安全
  return base;
}

function fieldToZod(f) {
  let v;
  switch (f.type) {
    case 'text':
      v = z.string().trim();
      if (f.rules && f.rules.max_length) v = v.max(f.rules.max_length, '内容过长');
      break;
    case 'textarea':
      v = z.string().trim();
      if (f.rules && f.rules.max_length) v = v.max(f.rules.max_length, '内容过长');
      break;
    case 'number': {
      v = z.number({ invalid_type_error: '必须为数字' });
      if (f.rules) {
        if (f.rules.min !== undefined) v = v.min(f.rules.min, `不能小于 ${f.rules.min}`);
        if (f.rules.max !== undefined) v = v.max(f.rules.max, `不能大于 ${f.rules.max}`);
      }
      break;
    }
    case 'amount': {
      v = z.number({ invalid_type_error: '必须为金额数字' }).int('金额必须为整数（分）');
      if (f.rules) {
        if (f.rules.min !== undefined) v = v.min(f.rules.min, `不能小于 ${f.rules.min / 100} 元`);
        if (f.rules.max !== undefined) v = v.max(f.rules.max, `不能大于 ${f.rules.max / 100} 元`);
      }
      break;
    }
    case 'date':
      v = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');
      break;
    case 'radio':
      v = z.enum(f.options || [], { errorMap: () => ({ message: '选项无效' }) });
      break;
    case 'attachment':
      v = z.array(z.number().int().positive()).max(20);
      break;
    default:
      v = z.any();
  }
  if (f.required) {
    // 必填；最终可见性由外层逻辑决定（见 validateCustomFormData）
  }
  return v.optional().nullable();
}

/**
 * 校验自定义表单数据：先按条件判断可见性，隐藏字段跳过必填校验。
 * 返回 { ok, errors: [{path, message}] }
 */
export function validateCustomFormData(schema, data) {
  const fields = (schema && schema.fields) || [];
  const errors = [];
  const values = data || {};

  /** 条件求值（与前端 conditionVisible 逻辑一致） */
  const visible = (f) => {
    if (!f.condition) return true;
    const refVal = values[f.condition.field];
    const cmp = f.condition.value;
    switch (f.condition.op) {
      case 'eq': return refVal === cmp;
      case 'neq': return refVal !== cmp;
      case 'gt': return Number(refVal) > Number(cmp);
      case 'lt': return Number(refVal) < Number(cmp);
      case 'in': return Array.isArray(cmp) && cmp.includes(refVal);
      default: return true;
    }
  };

  const shape = {};
  for (const f of fields) {
    const isVisible = visible(f);
    let v = fieldToZod(f);
    if (f.required && isVisible) {
      v = v.refine((val) => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'string' && !val.trim()) return false;
        if (Array.isArray(val) && val.length === 0) return false;
        return true;
      }, { message: '该项为必填项' });
    }
    shape[f.id] = v;
  }
  const schema2 = z.object(shape).strict();
  const result = schema2.safeParse(values);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({ path: issue.path.join('.'), message: issue.message });
    }
  }
  return { ok: errors.length === 0, errors, parsed: result.success ? result.data : null };
}

/** 取模板（供提交引用，仅 PUBLISHED 可用） */
export async function getPublishedTemplate(conn, templateId) {
  const [rows] = await conn.execute(
    'SELECT * FROM process_templates WHERE id = ? AND status = "PUBLISHED"',
    [templateId]
  );
  if (!rows.length) throw badRequest('流程模板不存在或未启用');
  return rows[0];
}
