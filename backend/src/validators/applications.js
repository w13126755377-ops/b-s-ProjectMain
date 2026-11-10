/**
 * 三类业务申请的服务端校验（zod）。
 * 金额字段一律为"分"（整数）；前端负责元→分转换，服务端再次校验并重算合计。
 * 校验规则与《设计文档》§7 一一对应。
 */
import { z } from 'zod';

const id = z.number().int().positive();
const title = z.string().trim().min(1, '标题不能为空').max(100, '标题最长 100 字');
const remark = z.string().trim().max(500, '备注最长 500 字').optional().default('');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');
const dateTimeStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, '时间格式应为 YYYY-MM-DD HH:mm')
  .refine((s) => !Number.isNaN(new Date(s).getTime()), '时间不是有效日期');
const cents = z.number().int('金额必须为整数（分）');

/* ---------------- 采购 ---------------- */
const procurementItem = z.object({
  name: z.string().trim().min(1, '物品或服务名称不能为空').max(100),
  spec: z.string().trim().max(100).optional().default(''),
  quantity: z.number().positive('数量必须大于 0').max(1e6),
  unit: z.string().trim().min(1, '单位不能为空').max(20),
  unitPriceCents: cents.nonnegative('预计单价不能为负数').max(1e12),
  // amountCents 由服务端重算，忽略客户端值
});

const quotation = z
  .object({
    supplierName: z.string().trim().min(1, '供应商名称不能为空').max(100),
    quoteDate: dateStr,
    quoteAmountCents: cents.nonnegative('报价金额不能为负数').max(1e12),
    quoteDetail: z.string().trim().max(500).optional().default(''),
    online: z.boolean().optional().default(false),
    purchaseLink: z.string().trim().max(300).optional().default(''),
    attachmentIds: z.array(id).max(5, '每份报价最多 5 个附件').optional().default([]),
    selected: z.boolean().optional().default(false),
  })
  .superRefine((q, ctx) => {
    // 线上购买必须提供购买链接和截图（附件）
    if (q.online) {
      if (!/^https?:\/\/.+/.test(q.purchaseLink)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['purchaseLink'], message: '线上购买必须提供购买链接' });
      }
      if (q.attachmentIds.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['attachmentIds'], message: '线上购买必须提供截图等报价依据附件' });
      }
    }
  });

export const procurementSchema = z
  .object({
    title,
    reason: z.string().trim().min(1, '采购原因不能为空').max(500),
    expectedArrivalDate: dateStr,
    project: z.string().trim().max(100).optional().default(''),
    budgetCapCents: cents.nonnegative('预算上限不能为负数').max(1e12),
    remark,
    items: z.array(procurementItem).min(2, '采购明细至少 2 条').max(50, '明细最多 50 条'),
    quotations: z.array(quotation).min(1, '至少 1 家报价').max(10, '报价最多 10 家'),
    singleSourceReason: z.string().trim().max(500).optional().default(''),
    selectReason: z.string().trim().max(500, '选择理由最长 500 字').optional().default(''),
  })
  .superRefine((form, ctx) => {
    const selectedQuotes = form.quotations.filter((q) => q.selected);
    if (selectedQuotes.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quotations'], message: '必须且只能选择 1 家拟选供应商' });
      return;
    }
    const selected = selectedQuotes[0];
    if (!form.selectReason.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['selectReason'], message: '必须填写选择该供应商的理由' });
    }
    if (form.quotations.length === 1) {
      // 单一来源采购：必须有说明，审批界面明确显示
      if (!form.singleSourceReason.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['singleSourceReason'], message: '单一来源采购必须填写说明' });
      }
    } else {
      // 未选最低价时必须说明理由
      const minAmount = Math.min(...form.quotations.map((q) => q.quoteAmountCents));
      if (selected.quoteAmountCents > minAmount && !form.selectReason.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['selectReason'], message: '未选最低价时必须说明理由' });
      }
    }
  });

/* ---------------- 差旅 ---------------- */
export const travelSchema = z
  .object({
    title,
    destination: z.string().trim().min(1, '目的地不能为空').max(100),
    departure: z.string().trim().min(1, '出发地点不能为空').max(100),
    startTime: dateTimeStr,
    endTime: dateTimeStr,
    purpose: z.string().trim().min(1, '出差目的不能为空').max(500),
    companions: z.array(z.string().trim().min(1).max(50)).max(20, '同行人员最多 20 人').optional().default([]),
    companionUserIds: z.array(id).max(20).optional().default([]),
    transport: z.string().trim().min(1, '交通方式不能为空').max(50),
    budgetCents: cents.nonnegative('费用预算不能为负数').max(1e12),
    remark,
    attachmentIds: z.array(id).max(20).optional().default([]),
  })
  .superRefine((form, ctx) => {
    if (new Date(form.endTime).getTime() < new Date(form.startTime).getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: '结束时间不得早于开始时间' });
    }
  });

/* ---------------- 报销 ---------------- */
export const EXPENSE_TYPES = ['TRAFFIC', 'HOTEL', 'MEAL', 'OFFICE', 'OTHER'];

const expenseItem = z.object({
  expenseType: z.enum(EXPENSE_TYPES, { errorMap: () => ({ message: '费用类型无效' }) }),
  occurDate: dateStr,
  purpose: z.string().trim().min(1, '用途说明不能为空').max(200),
  amountCents: cents.positive('明细金额必须大于 0').max(1e12),
  receiptNo: z.string().trim().max(64, '票据号码最长 64 字').optional().default(''),
  noReceipt: z.boolean().optional().default(false),
  noReceiptReason: z.string().trim().max(200).optional().default(''),
  attachmentIds: z.array(id).max(10, '每条明细最多 10 份票据').optional().default([]),
});

export const reimbursementSchema = z
  .object({
    title,
    description: z.string().trim().min(1, '报销说明不能为空').max(500),
    linkedApplicationId: id.nullable().optional(),
    remark,
    expenseItems: z.array(expenseItem).min(3, '费用明细至少 3 条').max(30, '费用明细最多 30 条'),
  })
  .superRefine((form, ctx) => {
    const seenAttachments = new Set();
    const seenNos = new Set();
    form.expenseItems.forEach((item, i) => {
      // 无票支出必须有例外原因（财务审核界面突出显示，不能静默跳过）
      if (item.noReceipt) {
        if (!item.noReceiptReason.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expenseItems', i, 'noReceiptReason'], message: '无票支出必须填写原因' });
        }
      } else if (item.attachmentIds.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expenseItems', i, 'attachmentIds'], message: '每条明细默认至少关联 1 份票据' });
      }
      // 同一张报销单内不能重复使用同一票据记录
      for (const attId of item.attachmentIds) {
        if (seenAttachments.has(attId)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expenseItems', i, 'attachmentIds'], message: '同一票据文件不能重复使用' });
        }
        seenAttachments.add(attId);
      }
      if (item.receiptNo.trim()) {
        if (seenNos.has(item.receiptNo.trim())) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expenseItems', i, 'receiptNo'], message: '同一票据号码不能重复使用' });
        }
        seenNos.add(item.receiptNo.trim());
      }
    });
  });
