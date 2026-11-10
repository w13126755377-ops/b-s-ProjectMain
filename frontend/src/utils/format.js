/** 展示与金额格式化工具（口径与《设计文档》§13.2 一致：金额一律整数"分"存储） */
import dayjs from 'dayjs';

/** 元→分（字符串运算避免浮点误差）。非法输入返回 null。 */
export function yuanToCents(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [intPart, decPart = ''] = s.split('.');
  return Number(intPart) * 100 + Number((decPart + '00').slice(0, 2));
}

/** 分→元字符串（保留两位小数） */
export function centsToYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

/** 分→千分位金额文本 */
export function centsToYuanText(cents) {
  return (Number(cents || 0) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDateTime(v) {
  return v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-';
}

export function formatDate(v) {
  return v ? dayjs(v).format('YYYY-MM-DD') : '-';
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

/* ---------- 常量标签 ---------- */

export const TYPE_LABEL = {
  PROCUREMENT: '采购申请',
  TRAVEL: '差旅申请',
  REIMBURSEMENT: '报销申请',
  CUSTOM: '自定义流程',
};

export const STATUS_LABEL = {
  DRAFT: '草稿',
  IN_APPROVAL: '审批中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  WITHDRAWN: '已撤回',
};

export const STATUS_TAG_TYPE = {
  DRAFT: 'info',
  IN_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'info',
};

export const EXPENSE_TYPE_LABEL = {
  TRAFFIC: '交通',
  HOTEL: '住宿',
  MEAL: '餐饮',
  OFFICE: '办公',
  OTHER: '其他',
};

export const ROLE_LABEL = {
  EMPLOYEE: '普通员工',
  DEPT_HEAD: '部门负责人',
  FINANCE: '财务',
  COMPANY_HEAD: '企业负责人',
  ADMIN: '系统管理员',
};

export const BIZ_TYPE_LABEL = {
  QUOTATION: '报价依据',
  TRAVEL: '差旅附件',
  RECEIPT: '票据',
  CUSTOM: '附件',
};

export const ACTION_LABEL = {
  SUBMIT: '提交申请',
  APPROVE: '审批通过',
  REJECT: '驳回',
  WITHDRAW: '撤回申请',
};

export const NOTIFY_TYPE_ICON = {
  TODO: 'Bell',
  APPROVED: 'CircleCheck',
  REJECTED: 'CircleClose',
  WITHDRAWN: 'RefreshLeft',
  REMIND: 'AlarmClock',
  SYSTEM: 'InfoFilled',
};
