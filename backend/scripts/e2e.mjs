/**
 * E2E 端到端验证脚本（作业验收自测 + 实验报告数据来源）。
 *
 * 前置条件：
 *   1. MySQL 已执行 backend/sql/init/01_schema.sql + 02_seed.sql（演示账号就绪）；
 *   2. 后端已启动（默认 http://localhost:3000，可用环境变量 E2E_BASE 覆盖）。
 * 运行：node backend/scripts/e2e.mjs
 * 可选：E2E_SLOW=1 追加"超时催办"慢场景（约 +100s）。
 *
 * 覆盖：注册/登录/资料、部门确认门禁、三类流程全链路（校验/编号/快照/审批/驳回/撤回/复制/
 * 委托/自审/阈值加签/并发单赢/双击幂等）、附件规则（格式/大小/权限/去重）、自定义模板
 * （发布校验/版本/指定用户/管理员权限边界）、通知（去重/已读/跳转）、统计口径、
 * 管理后台（用户/角色/部门/模板/配置/审计/统计授权）。
 */
import { Buffer } from 'node:buffer';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const SLOW = process.env.E2E_SLOW === '1';

/* ------------------------------ 结果收集 ------------------------------ */
const results = [];
function check(name, cond, extra = '') {
  const ok = !!cond;
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
}
function errMsg(r) {
  return (r.data && (r.data.message || (r.data.errors && JSON.stringify(r.data.errors)))) || String(r.status);
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* ------------------------------ HTTP 封装 ------------------------------ */
async function api(token, method, path, { body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

const tokens = {};
const users = {};
async function login(u, p) {
  const r = await api(null, 'POST', '/api/auth/login', { body: { account: u, password: p } });
  if (r.status !== 200) throw new Error(`登录失败 ${u}: ${errMsg(r)}`);
  tokens[u] = r.data.data.token;
  users[u] = r.data.data.user;
  return users[u];
}
const A = (u) => ({ Authorization: `Bearer ${tokens[u]}` });

/* ------------------------------ 文件夹具 ------------------------------ */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
const PDF_TEXT = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF';
const pngBytes = () => Buffer.from(PNG_B64, 'base64');
const jpgBytes = () => Buffer.from(JPG_B64, 'base64');
const pdfBytes = () => Buffer.from(PDF_TEXT, 'utf8');
async function upload(token, appId, bizType, name, bytes, mime) {
  const f = new FormData();
  f.append('file', new Blob([bytes], { type: mime }), name);
  f.append('application_id', String(appId));
  f.append('biz_type', bizType);
  const r = await api(token, 'POST', '/api/attachments', { form: f });
  return r;
}

/* ------------------------------ 业务快捷封装 ------------------------------ */
async function createApp(token, payload) {
  const r = await api(token, 'POST', '/api/applications', { body: payload });
  return { status: r.status, data: r.data.data, raw: r.data, err: errMsg(r) };
}
async function submit(token, id) {
  const r = await api(token, 'POST', `/api/applications/${id}/submit`);
  return { status: r.status, data: r.data.data, raw: r.data, err: errMsg(r) };
}
async function detail(token, id) {
  const r = await api(token, 'GET', `/api/applications/${id}`);
  return { status: r.status, data: r.data.data, err: errMsg(r) };
}
async function approve(token, instanceId, comment) {
  const r = await api(token, 'POST', `/api/tasks/${instanceId}/approve`, { body: comment !== undefined ? { comment } : {} });
  return { status: r.status, data: r.data.data, err: errMsg(r) };
}
async function reject(token, instanceId, reason) {
  const r = await api(token, 'POST', `/api/tasks/${instanceId}/reject`, { body: { reason } });
  return { status: r.status, data: r.data.data, err: errMsg(r) };
}

const PROC = (title, items, quotes, extra = {}) => ({
  type: 'PROCUREMENT', title,
  reason: 'E2E 采购', expectedArrivalDate: '2026-12-20', project: 'E2E 项目',
  budgetCapCents: 100000000, remark: '端到端测试',
  selectReason: '端到端测试：选择理由', // 选择理由必填（§7.1），成功用例默认补齐
  items,
  quotations: quotes.map((q) => ({ quoteDate: '2026-11-05', quoteDetail: '报价明细', ...q })),
  ...extra,
});

/* ======================================================================== */
console.log(`E2E 目标: ${BASE}  慢场景: ${SLOW}`);
console.log('--- S1 认证 ---');
let r = await api(null, 'POST', '/api/auth/login', { body: { account: 'admin', password: 'Wrong@123' } });
check('S1.1 错误密码登录 401', r.status === 401);
await login('admin', 'Admin@123');
check('S1.2 admin 登录成功且带 ADMIN 角色', users.admin.roleCodes.includes('ADMIN'));
r = await api(tokens.admin, 'GET', '/api/users/me');
check('S1.3 /me 返回当前用户', r.status === 200 && r.data.data.id === 1);

console.log('--- S2 注册 ---');
const uname = `e2e_${Date.now() % 100000000}`;
r = await api(null, 'POST', '/api/auth/register', { body: { username: uname, name: 'E2E用户', email: `${uname}@test.com`, password: 'E2ePass123', deptId: 1 } });
check('S2.1 注册成功', r.status === 200, errMsg(r));
r = await api(null, 'POST', '/api/auth/register', { body: { username: uname, name: '重复', email: `${uname}2@test.com`, password: 'E2ePass123', deptId: 1 } });
check('S2.2 重复用户名注册被拒', r.status === 400);
r = await api(null, 'POST', '/api/auth/register', { body: { username: `w_${Date.now() % 100000000}`, name: '弱密码', email: `w${Date.now() % 100000000}@t.com`, password: 'abc', deptId: 1 } });
check('S2.3 弱密码注册被拒', r.status === 400);
r = await api(null, 'GET', '/api/departments');
check('S2.4 部门列表公开（注册页）', r.status === 200 && r.data.data.length >= 4);
await login(uname, 'E2ePass123');
check('S2.5 新用户默认未确认部门归属', users[uname].dept_confirmed === 0);

console.log('--- S3 部门确认门禁 ---');
const travelPayload = {
  type: 'TRAVEL', title: 'E2E 门禁差旅', destination: '上海', departure: '武汉',
  startTime: '2026-12-10 08:00', endTime: '2026-12-12 18:00', purpose: '客户拜访',
  companions: [], companionUserIds: [], transport: '高铁', budgetCents: 500000, remark: '', attachmentIds: [],
};
let c = await createApp(tokens[uname], travelPayload);
check('S3.1 草稿创建成功', c.status === 200);
let s = await submit(tokens[uname], c.data.id);
check('S3.2 未确认部门归属禁止提交(400)', s.status === 400, s.err);
r = await api(tokens.admin, 'PATCH', `/api/admin/users/${users[uname].id}`, { body: { deptConfirmed: true } });
check('S3.3 管理员确认部门归属', r.status === 200);
s = await submit(tokens[uname], c.data.id);
check('S3.4 确认后可提交', s.status === 200, s.err);
r = await api(tokens[uname], 'POST', `/api/applications/${c.data.id}/withdraw`);
const wd = await detail(tokens[uname], c.data.id);
check('S3.5 撤回成功 → WITHDRAWN', r.status === 200 && wd.data.status === 'WITHDRAWN');

console.log('--- S4 差旅流程 ---');
await login('sunqi', 'Sunqi@123');
c = await createApp(tokens.sunqi, { ...travelPayload, title: 'E2E 时间倒挂', startTime: '2026-12-12 08:00', endTime: '2026-12-10 18:00' });
check('S4.1 结束早于开始被拒', c.status === 400, c.err);
c = await createApp(tokens.sunqi, { ...travelPayload, title: 'E2E 出差上海', startTime: '2026-12-01 08:00', endTime: '2026-12-03 20:00', budgetCents: 500000 });
check('S4.2 差旅草稿创建', c.status === 200);
// 差旅附件（JPEG 正向用例）
let up = await upload(tokens.sunqi, c.data.id, 'TRAVEL', '行程.jpg', jpgBytes(), 'image/jpeg');
check('S4.3 JPEG 上传成功', up.status === 200, errMsg(up));
await api(tokens.sunqi, 'PATCH', `/api/applications/${c.data.id}`, { body: { type: 'TRAVEL', title: 'E2E 出差上海', destination: '上海', departure: '武汉', startTime: '2026-12-01 08:00', endTime: '2026-12-03 20:00', purpose: '客户拜访', companions: [], companionUserIds: [], transport: '高铁', budgetCents: 500000, remark: '', attachmentIds: [up.data.data.id] } });
s = await submit(tokens.sunqi, c.data.id);
check('S4.4 差旅提交成功', s.status === 200, s.err);
let travelAppId = c.data.id;
let d = await detail(tokens.sunqi, travelAppId);
check('S4.5 单号格式 CX+日期-序号', /^CX\d{8}-\d{4}$/.test(d.data.app_no), d.data.app_no);
check('S4.6 系统计算天数=3（60h/24h 向上取整）', d.data.form_data.days === 3, `days=${d.data.form_data.days}`);
check('S4.7 金额为预算（分）', d.data.total_amount_cents === 500000);
check('S4.8 差旅流程仅部门负责人节点（预算<阈值）', d.data.instance.nodes.length === 1 && d.data.instance.nodes[0].rule.type === 'DEPT_HEAD');
await login('zhangsan', 'Zhangsan@123');
let ap = await approve(tokens.zhangsan, d.data.instance.id, '同意出差');
check('S4.9 部门负责人批准 → APPROVED', ap.status === 200);
d = await detail(tokens.sunqi, travelAppId);
check('S4.10 状态 APPROVED 且 finished_at 非空', d.data.status === 'APPROVED' && !!d.data.finished_at);
await login('wujiu', 'Wujiu@123');
c = await createApp(tokens.wujiu, { ...travelPayload, title: 'E2E 无负责人部门差旅' });
s = await submit(tokens.wujiu, c.data.id);
check('S4.11 部门无负责人时提交报错(400)', s.status === 400, s.err);

console.log('--- S5 报销流程（票据规则/无票高亮/关联差旅/跨单预警）---');
await login('sunqi', 'Sunqi@123');
const exp = (type, amountCents, att) => ({ expenseType: type, occurDate: '2026-12-04', purpose: 'E2E 支出', amountCents, receiptNo: '', noReceipt: false, noReceiptReason: '', attachmentIds: att });
c = await createApp(tokens.sunqi, { type: 'REIMBURSEMENT', title: 'E2E 明细不足', description: 'x', linkedApplicationId: null, remark: '', expenseItems: [
  { ...exp('TRAFFIC', 100, []), noReceipt: true, noReceiptReason: '无票' },
  { ...exp('HOTEL', 200, []), noReceipt: true, noReceiptReason: '无票' },
] });
check('S5.1 报销明细<3 被拒', c.status === 400, c.err);
c = await createApp(tokens.sunqi, { type: 'REIMBURSEMENT', title: 'E2E 关联他人申请', description: 'x', linkedApplicationId: 999999, remark: '', expenseItems: [
  { ...exp('TRAFFIC', 100, []), noReceipt: true, noReceiptReason: '无票' },
  { ...exp('HOTEL', 200, []), noReceipt: true, noReceiptReason: '无票' },
  { ...exp('MEAL', 50, []), noReceipt: true, noReceiptReason: '无票' },
] });
check('S5.2 关联不存在的申请被拒', c.status === 400, c.err);
c = await createApp(tokens.sunqi, { type: 'REIMBURSEMENT', title: 'E2E 报销单', description: '出差报销', linkedApplicationId: null, remark: '', expenseItems: [exp('TRAFFIC', 10000, []), exp('HOTEL', 200000, []), exp('OTHER', 3000, [])] });
check('S5.3 报销草稿创建', c.status === 200);
let rmbId = c.data.id;
up = await upload(tokens.sunqi, rmbId, 'RECEIPT', '发票A.png', pngBytes(), 'image/png');
const pngA = up.data.data.id;
up = await upload(tokens.sunqi, rmbId, 'RECEIPT', '发票B.pdf', pdfBytes(), 'application/pdf');
const pdfB = up.data.data.id;
check('S5.4 票据上传（PNG/PDF）', pngA > 0 && pdfB > 0);
const upd = async (items) => api(tokens.sunqi, 'PATCH', `/api/applications/${rmbId}`, { body: { type: 'REIMBURSEMENT', title: 'E2E 报销单', description: '出差报销', linkedApplicationId: travelAppId, remark: '', expenseItems: items } });
// 同单票据重复 → 拒绝
r = await upd([
  { ...exp('TRAFFIC', 10000, [pngA]), receiptNo: 'R001' },
  { ...exp('HOTEL', 200000, []), noReceipt: true, noReceiptReason: '住宿发票遗失' },
  { ...exp('OTHER', 3000, [pngA]), receiptNo: 'R001' },
]);
check('S5.5 同单票据 id/票据号重复被拒', r.status === 400, errMsg(r));
// 修正后提交
r = await upd([
  { ...exp('TRAFFIC', 10000, [pngA]), receiptNo: 'R001' },
  { ...exp('HOTEL', 200000, []), noReceipt: true, noReceiptReason: '住宿发票遗失' },
  { ...exp('OTHER', 3000, [pdfB]) },
]);
check('S5.5b 修正后保存成功', r.status === 200, errMsg(r));
s = await submit(tokens.sunqi, rmbId);
check('S5.6 报销提交成功（关联已批准差旅）', s.status === 200, s.err);
d = await detail(tokens.sunqi, rmbId);
check('S5.7 合计=服务端重算 213000 分', d.data.total_amount_cents === 213000, `got=${d.data.total_amount_cents}`);
check('S5.8 关联申请信息回显', d.data.linkedApplication?.id === travelAppId);
check('S5.9 无票支出标记（财务审核高亮依据）', d.data.expenseItems.some((e) => e.no_receipt === 1 && e.no_receipt_reason));
check('S5.10 报销链=部门负责人→财务', d.data.instance.nodes.length === 2 && d.data.instance.nodes[1].rule.type === 'FINANCE');
await login('zhangsan', 'Zhangsan@123');
await approve(tokens.zhangsan, d.data.instance.id);
await login('wangwu', 'Wangwu@123');
ap = await approve(tokens.wangwu, d.data.instance.id, '票据齐全');
check('S5.11 财务批准 → APPROVED', ap.status === 200);
// 跨单重复票据预警
c = await createApp(tokens.sunqi, { type: 'REIMBURSEMENT', title: 'E2E 第二次报销', description: 'x', linkedApplicationId: null, remark: '', expenseItems: [exp('TRAFFIC', 100, []), exp('HOTEL', 200, []), exp('MEAL', 50, [])] });
let rmb2Id = c.data.id;
up = await upload(tokens.sunqi, rmb2Id, 'RECEIPT', '发票A.png', pngBytes(), 'image/png');
const pngA2 = up.data.data.id;
await api(tokens.sunqi, 'PATCH', `/api/applications/${rmb2Id}`, { body: { type: 'REIMBURSEMENT', title: 'E2E 第二次报销', description: 'x', linkedApplicationId: null, remark: '', expenseItems: [
  { ...exp('TRAFFIC', 100, [pngA2]) }, { ...exp('HOTEL', 200, []), noReceipt: true, noReceiptReason: '无' }, { ...exp('MEAL', 50, []), noReceipt: true, noReceiptReason: '无票' },
] } });
s = await submit(tokens.sunqi, rmb2Id);
check('S5.12 跨单重复票据预警（提交返回 warnings）', s.status === 200 && Array.isArray(s.data?.warnings) && s.data.warnings.length >= 1, JSON.stringify(s.data?.warnings));
d = await detail(tokens.sunqi, rmb2Id);
check('S5.13 详情含重复票据预警列表', Array.isArray(d.data.duplicateWarnings) && d.data.duplicateWarnings.length >= 1);
await api(tokens.sunqi, 'POST', `/api/applications/${rmb2Id}/withdraw`);
await login('zhangsan', 'Zhangsan@123');

console.log('--- S6 采购流程（市场部：lisi→wangwu）---');
await login('zhouba', 'Zhouba@123');
const procItems = (price1, price2) => [
  { name: '开发板', spec: 'V2', quantity: 2, unit: '块', unitPriceCents: price1 },
  { name: '传感器', spec: 'X9', quantity: 1, unit: '个', unitPriceCents: price2 },
];
c = await createApp(tokens.zhouba, PROC('E2E 明细不足', procItems(100, 200), [{ supplierName: '甲', quoteAmountCents: 400, selected: true }]));
check('S6.1 采购明细<2 被拒', c.status === 400, c.err);
// 非最低价说明必填
c = await createApp(tokens.zhouba, PROC('E2E 采购-非最低价', procItems(350000, 400000), [
  { supplierName: '甲', quoteAmountCents: 900000 },
  { supplierName: '乙', quoteAmountCents: 1100000, selected: true },
], { selectReason: '' }));
check('S6.2 未选最低价且无说明被拒', c.status === 400, c.err);
// 修正：补 selectReason
let proc1 = await createApp(tokens.zhouba, PROC('E2E 采购-非最低价', procItems(350000, 400000), [
  { supplierName: '甲', quoteAmountCents: 900000 },
  { supplierName: '乙', quoteAmountCents: 1100000, selected: true },
], { selectReason: '乙供应商交期更快，售后响应及时' }));
check('S6.3 补充说明后草稿创建成功', proc1.status === 200, proc1.err);
s = await submit(tokens.zhouba, proc1.data.id);
check('S6.4 提交成功', s.status === 200, s.err);
d = await detail(tokens.zhouba, proc1.data.id);
check('S6.5 单号格式 CG+日期-序号', /^CG\d{8}-\d{4}$/.test(d.data.app_no), d.data.app_no);
check('S6.6 总额=拟选报价 1100000 分', d.data.total_amount_cents === 1100000, `got=${d.data.total_amount_cents}`);
check('S6.7 链=部门负责人→财务（lisi→wangwu）', d.data.instance.nodes.length === 2 && d.data.instance.nodes[0].resolved_username === 'lisi' && d.data.instance.nodes[1].resolved_username === 'wangwu');
await login('lisi', 'Lisi@123');
await approve(tokens.lisi, d.data.instance.id, '同意');
await login('wangwu', 'Wangwu@123');
ap = await approve(tokens.wangwu, d.data.instance.id, '预算内');
check('S6.8 财务批准 → APPROVED', ap.status === 200);
// 单一来源
c = await createApp(tokens.zhouba, PROC('E2E 单源无说明', procItems(100, 200), [{ supplierName: '独家供应商', quoteAmountCents: 50000, selected: true }]));
check('S6.9 单一来源无说明被拒', c.status === 400, c.err);
c = await createApp(tokens.zhouba, PROC('E2E 单一来源采购', procItems(100, 200), [{ supplierName: '独家供应商', quoteAmountCents: 50000, selected: true }], { singleSourceReason: '该器件为独家专利产品', selectReason: '独家供应商，无其他可选' }));
s = await submit(tokens.zhouba, c.data.id);
check('S6.10 单一来源+说明提交成功', s.status === 200, s.err);
d = await detail(tokens.zhouba, c.data.id);
check('S6.11 单源标记 is_single_source', d.data.quotations[0].is_single_source === 1);

console.log('--- S7 驳回（理由必填）与复制重提 ---');
await login('lisi', 'Lisi@123');
let ap0 = await reject(tokens.lisi, d.data.instance.id, undefined);
check('S7.1 驳回无理由被拒(400)', ap0.status === 400);
ap0 = await reject(tokens.lisi, d.data.instance.id, '供应商资质不足，请更换');
check('S7.2 驳回成功 → REJECTED', ap0.status === 200);
d = await detail(tokens.zhouba, c.data.id);
check('S7.3 驳回记录含理由', d.data.status === 'REJECTED' && d.data.records.some((x) => x.action === 'REJECT' && x.comment.includes('供应商资质不足')));
r = await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/copy`);
const copyId = r.data.data?.id;
const cd = await detail(tokens.zhouba, copyId);
check('S7.4 复制重提生成新草稿', r.status === 200 && copyId && copyId !== c.data.id && cd.data.status === 'DRAFT');

console.log('--- S8 阈值加签：企业负责人节点 ---');
await login('zhouba', 'Zhouba@123');
c = await createApp(tokens.zhouba, PROC('E2E 大额采购', procItems(3000000, 2000000), [
  { supplierName: '甲', quoteAmountCents: 12500000, selected: true },
  { supplierName: '乙', quoteAmountCents: 13000000 },
]));
s = await submit(tokens.zhouba, c.data.id);
check('S8.1 大额采购提交成功', s.status === 200, s.err);
d = await detail(tokens.zhouba, c.data.id);
check('S8.2 链含企业负责人节点（3 节点）', d.data.instance.nodes.length === 3 && d.data.instance.nodes[2].rule.type === 'COMPANY_HEAD' && d.data.instance.nodes[2].resolved_username === 'zhaoliu');
check('S8.3 阈值快照 10000000 分', d.data.instance.threshold_cents === 10000000);
await login('lisi', 'Lisi@123');
await approve(tokens.lisi, d.data.instance.id);
await login('wangwu', 'Wangwu@123');
await approve(tokens.wangwu, d.data.instance.id);
await login('zhaoliu', 'Zhaoliu@123');
ap = await approve(tokens.zhaoliu, d.data.instance.id, '同意');
check('S8.4 企业负责人终审 → APPROVED', ap.status === 200);
d = await detail(tokens.zhouba, c.data.id);
check('S8.5 最终 APPROVED', d.data.status === 'APPROVED');

console.log('--- S9 双击提交幂等 ---');
await login('zhouba', 'Zhouba@123');
c = await createApp(tokens.zhouba, PROC('E2E 双击提交', procItems(100, 200), [
  { supplierName: '甲', quoteAmountCents: 50000, selected: true },
  { supplierName: '乙', quoteAmountCents: 60000 },
]));
const [sA, sB] = await Promise.all([submit(tokens.zhouba, c.data.id), submit(tokens.zhouba, c.data.id)]);
const okCount = [sA, sB].filter((x) => x.status === 200).length;
const errCount = [sA, sB].filter((x) => x.status >= 400).length;
check('S9.1 双击提交仅一方成功', okCount === 1 && errCount === 1, `ok=${okCount} err=${errCount}`);
d = await detail(tokens.zhouba, c.data.id);
check('S9.2 仅一个流程实例', d.data.instance && d.data.records.filter((x) => x.action === 'SUBMIT').length === 1);
await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/withdraw`);
d = await detail(tokens.zhouba, c.data.id);
check('S9.3 撤回清理 → WITHDRAWN', d.data.status === 'WITHDRAWN');

console.log('--- S10 撤回与审批并发：仅一方生效 ---');
await login('zhouba', 'Zhouba@123');
c = await createApp(tokens.zhouba, PROC('E2E 并发竞争', procItems(100, 200), [
  { supplierName: '甲', quoteAmountCents: 50000, selected: true },
  { supplierName: '乙', quoteAmountCents: 60000 },
]));
s = await submit(tokens.zhouba, c.data.id);
d = await detail(tokens.zhouba, c.data.id);
await login('lisi', 'Lisi@123');
const [wR, aR] = await Promise.all([
  api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/withdraw`),
  approve(tokens.lisi, d.data.instance.id, '抢先审批'),
]);
const oneWin = (wR.status === 200) !== (aR.status === 200);
check('S10.1 撤回/审批并发仅一方成功', oneWin, `withdraw=${wR.status} approve=${aR.status}`);
d = await detail(tokens.zhouba, c.data.id);
const consistent = d.data.status === 'WITHDRAWN' || (d.data.status === 'IN_APPROVAL' && d.data.instance?.current_approver_id !== null);
check('S10.2 状态一致（WITHDRAWN 或 仍在审批）', consistent, d.data.status);
if (d.data.status === 'IN_APPROVAL') {
  await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/withdraw`);
}

console.log('--- S11 委托与不可自审 ---');
await login('zhangsan', 'Zhangsan@123');
c = await createApp(tokens.zhangsan, PROC('E2E 负责人自审', procItems(200000, 100000), [
  { supplierName: '甲', quoteAmountCents: 770000, selected: true },
  { supplierName: '乙', quoteAmountCents: 800000 },
], { selectReason: '甲交付更快' }));
s = await submit(tokens.zhangsan, c.data.id);
check('S11.1 审批人=申请人本人时提交被拒(400)', s.status === 400, s.err);
// 管理员授予 sunqi 部门负责人角色
r = await api(tokens.admin, 'PUT', '/api/admin/users/6/roles', { body: { roleIds: [1, 2] } });
check('S11.2 管理员授予 sunqi 部门负责人', r.status === 200);
s = await submit(tokens.zhangsan, c.data.id);
check('S11.3 多负责人按用户名排序解析 → sunqi', s.status === 200, s.err);
d = await detail(tokens.zhangsan, c.data.id);
check('S11.4 首节点审批人=sunqi（sunqi<zhangsan 排序）', d.data.instance.nodes[0].resolved_username === 'sunqi');
await login('sunqi', 'Sunqi@123');
await approve(tokens.sunqi, d.data.instance.id, '部门同意');
await login('wangwu', 'Wangwu@123');
ap = await approve(tokens.wangwu, d.data.instance.id);
check('S11.5 zhangsan 申请 APPROVED', ap.status === 200);
// sunqi 自审被拒 → 委托 zhangsan 解决
await login('sunqi', 'Sunqi@123');
c = await createApp(tokens.sunqi, PROC('E2E 负责人委托', procItems(100000, 100000), [
  { supplierName: '甲', quoteAmountCents: 660000, selected: true },
  { supplierName: '乙', quoteAmountCents: 700000 },
], { selectReason: '甲更快' }));
s = await submit(tokens.sunqi, c.data.id);
check('S11.6 自己也是负责人 → 自审被拒', s.status === 400, s.err);
r = await api(tokens.sunqi, 'POST', '/api/delegations', { body: { delegateeId: 2, startTime: '2026-11-01 00:00', endTime: '2026-12-31 23:59', reason: 'E2E 委托' } });
check('S11.7 委托给同部门负责人成功', r.status === 200, errMsg(r));
s = await submit(tokens.sunqi, c.data.id);
check('S11.8 委托后提交成功', s.status === 200, s.err);
d = await detail(tokens.sunqi, c.data.id);
check('S11.9 首节点 delegated_from=sunqi 受托人 zhangsan', d.data.instance.nodes[0].resolved_username === 'zhangsan' && d.data.instance.nodes[0].delegated_from === users.sunqi.id);
await login('zhangsan', 'Zhangsan@123');
ap = await approve(tokens.zhangsan, d.data.instance.id, '受托代办同意');
check('S11.10 受托人代办审批成功', ap.status === 200);
d = await detail(tokens.sunqi, c.data.id);
check('S11.11 审批记录留痕（acted_by=zhangsan）', d.data.records.some((x) => x.action === 'APPROVE' && x.acted_by_username === 'zhangsan'));
await login('wangwu', 'Wangwu@123');
await approve(tokens.wangwu, d.data.instance.id);
// 非法委托
r = await api(tokens.zhangsan, 'POST', '/api/delegations', { body: { delegateeId: 2, startTime: '2026-11-01 00:00', endTime: '2026-12-31 23:59', reason: '委托给自己' } });
check('S11.12 委托给本人被拒', r.status === 400);
r = await api(tokens.lisi, 'POST', '/api/delegations', { body: { delegateeId: 6, startTime: '2026-11-01 00:00', endTime: '2026-12-31 23:59', reason: '跨部门' } });
const lisiDelId = r.data.data?.id;
check('S11.13 跨部门委托创建成功（约束在提交解析时生效）', r.status === 200, errMsg(r));
await login('zhouba', 'Zhouba@123');
c = await createApp(tokens.zhouba, PROC('E2E 跨部门委托拦截', procItems(100, 200), [
  { supplierName: '甲', quoteAmountCents: 50000, selected: true },
  { supplierName: '乙', quoteAmountCents: 60000 },
]));
s = await submit(tokens.zhouba, c.data.id);
check('S11.14 跨部门受托人被拒（部门负责人须同部门）', s.status === 400, s.err);
await api(tokens.lisi, 'DELETE', `/api/delegations/${lisiDelId}`);
r = await api(tokens.wangwu, 'POST', '/api/delegations', { body: { delegateeId: 7, startTime: '2026-11-01 00:00', endTime: '2026-12-31 23:59', reason: '无财务角色' } });
const wangwuDelId = r.data.data?.id;
s = await submit(tokens.zhouba, c.data.id);
check('S11.15 受托人缺少财务角色被拒', s.status === 400, s.err);
await api(tokens.wangwu, 'DELETE', `/api/delegations/${wangwuDelId}`);
s = await submit(tokens.zhouba, c.data.id);
check('S11.16 清理委托后提交成功', s.status === 200, s.err);
d = await detail(tokens.zhouba, c.data.id);
// 催办（每节点限 1 次）
r = await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/remind`);
const remindOk = r.status === 200;
r = await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/remind`);
check('S11.17 催办成功且同节点二次催办 409', remindOk && r.status === 409, `2nd=${r.status}`);
await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/withdraw`);

console.log('--- S12 自定义模板：发布校验/全流程/管理员权限边界 ---');
await login('admin', 'Admin@123');
const tplBody = (patch = {}) => ({
  name: 'E2E 用章申请', description: '端到端自定义流程', applicableDepts: [2],
  formSchema: { fields: [
    { id: 'f_amount', type: 'amount', label: '金额', required: true, rules: { min: 0 } },
    { id: 'f_radio', type: 'radio', label: '类型', required: true, options: ['合同章', '公章'] },
    { id: 'f_cond', type: 'text', label: '合同编号', required: true, condition: { field: 'f_radio', op: 'eq', value: '合同章' } },
  ] },
  flowConfig: { nodes: [
    { name: '部门负责人审批', rule: { type: 'DEPT_HEAD' } },
    { name: '管理员核签', rule: { type: 'SPECIFIED_USER', user_id: 1 } },
  ] },
  ...patch,
});
// 发布校验：节点不足
r = await api(tokens.admin, 'POST', '/api/admin/templates', { body: tplBody({ flowConfig: { nodes: [{ name: '单人审批', rule: { type: 'DEPT_HEAD' } }] } }) });
let t1 = r.data.data?.id;
r = await api(tokens.admin, 'POST', `/api/admin/templates/${t1}/publish`);
check('S12.1 节点<2 禁止发布', r.status === 400, errMsg(r));
// 发布校验：字段 id 重复
r = await api(tokens.admin, 'POST', '/api/admin/templates', { body: tplBody({ formSchema: { fields: [
  { id: 'dup', type: 'text', label: 'A', required: false },
  { id: 'dup', type: 'text', label: 'B', required: false },
] } }) });
let t2 = r.data.data?.id;
r = await api(tokens.admin, 'POST', `/api/admin/templates/${t2}/publish`);
check('S12.2 字段 id 重复禁止发布', r.status === 400, errMsg(r));
// 发布校验：条件引用不存在
r = await api(tokens.admin, 'POST', '/api/admin/templates', { body: tplBody({ formSchema: { fields: [
  { id: 'f1', type: 'text', label: 'A', required: true, condition: { field: 'ghost', op: 'eq', value: 'x' } },
] } }) });
let t3 = r.data.data?.id;
r = await api(tokens.admin, 'POST', `/api/admin/templates/${t3}/publish`);
check('S12.3 条件引用不存在的字段禁止发布', r.status === 400, errMsg(r));
// 合法模板发布
r = await api(tokens.admin, 'POST', '/api/admin/templates', { body: tplBody() });
const tplId = r.data.data.id;
r = await api(tokens.admin, 'POST', `/api/admin/templates/${tplId}/publish`);
check('S12.4 合法模板发布成功（v1 PUBLISHED）', r.status === 200, errMsg(r));
// 员工可见性
await login('zhouba', 'Zhouba@123');
r = await api(tokens.zhouba, 'GET', '/api/templates/published');
check('S12.5 员工可见已发布自定义模板（适用部门过滤）', r.data.data.custom.some((x) => x.id === tplId));
// 条件字段：f_radio='b' 时 f_cond 隐藏 → 可缺省
c = await createApp(tokens.zhouba, { type: 'CUSTOM', templateId: tplId, title: 'E2E 用章', formData: { f_amount: 10000, f_radio: '公章' } });
s = await submit(tokens.zhouba, c.data.id);
check('S12.6 隐藏字段跳过必填，提交成功', s.status === 200, s.err);
d = await detail(tokens.zhouba, c.data.id);
check('S12.7 链=部门负责人(lisi)→指定用户(admin)', d.data.instance.nodes.length === 2 && d.data.instance.nodes[1].resolved_username === 'admin');
// 管理员权限边界：管理权限 ≠ 审批权限。用「管理员不在审批链内」的采购申请验证详情不可见。
const cb = await createApp(tokens.zhouba, PROC('E2E 管理员越权', procItems(100, 200), [
  { supplierName: '甲', quoteAmountCents: 50000, selected: true },
  { supplierName: '乙', quoteAmountCents: 60000 },
]));
await submit(tokens.zhouba, cb.data.id);
r = await detail(tokens.admin, cb.data.id);
check('S12.8 管理员非审批链成员时详情 403', r.status === 403);
await api(tokens.zhouba, 'POST', `/api/applications/${cb.data.id}/withdraw`);
await login('lisi', 'Lisi@123');
await approve(tokens.lisi, d.data.instance.id, '部门同意');
await login('admin', 'Admin@123');
r = await api(tokens.admin, 'GET', '/api/tasks?scope=todo');
const adminTodo = r.data.data;
check('S12.9 指定用户节点进入管理员待办', Array.isArray(adminTodo) && adminTodo.some((x) => x.application_id === c.data.id));
d = await detail(tokens.admin, c.data.id);
check('S12.10 成为审批人后可访问详情', d.status === 200);
ap = await approve(tokens.admin, d.data.instance.id, '核签通过');
check('S12.11 管理员核签 → APPROVED', ap.status === 200);
// 必填字段缺失
c = await createApp(tokens.zhouba, { type: 'CUSTOM', templateId: tplId, title: 'E2E 用章-缺金额', formData: { f_radio: '公章' } });
check('S12.12 必填字段缺失被拒', c.status === 400, c.err);
// 条件可见时必填
c = await createApp(tokens.zhouba, { type: 'CUSTOM', templateId: tplId, title: 'E2E 用章-合同', formData: { f_amount: 10000, f_radio: '合同章' } });
check('S12.13 条件可见的必填字段缺失被拒', c.status === 400, c.err);

console.log('--- S13 附件：格式/大小/越权/草稿限定 ---');
await login('zhouba', 'Zhouba@123');
c = await createApp(tokens.zhouba, PROC('E2E 附件测试', procItems(100, 200), [
  { supplierName: '甲', quoteAmountCents: 50000, selected: true },
  { supplierName: '乙', quoteAmountCents: 60000 },
]));
const attAppId = c.data.id;
up = await upload(tokens.zhouba, attAppId, 'QUOTATION', '报价单.png', pngBytes(), 'image/png');
check('S13.1 采购报价附件上传成功', up.status === 200, errMsg(up));
const attId = up.data.data.id;
r = await upload(tokens.zhouba, attAppId, 'RECEIPT', '伪装票据.png', pngBytes(), 'image/png');
check('S13.2 biz_type 与申请类型不符被拒（防票据伪装）', r.status === 400);
r = await upload(tokens.zhouba, attAppId, 'QUOTATION', '文档.txt', Buffer.from('hello'), 'text/plain');
check('S13.3 TXT 格式被拒', r.status === 400);
r = await upload(tokens.zhouba, attAppId, 'QUOTATION', '动图.gif', Buffer.from('GIF89a'), 'image/gif');
check('S13.4 GIF 格式被拒', r.status === 400);
r = await upload(tokens.zhouba, attAppId, 'QUOTATION', '超大.png', Buffer.alloc(11 * 1024 * 1024), 'image/png');
check('S13.5 超过 10MB 被拒(413)', r.status === 413, `got=${r.status}`);
r = await upload(tokens.sunqi, attAppId, 'QUOTATION', '越权.png', pngBytes(), 'image/png');
check('S13.6 非申请人上传被拒(403)', r.status === 403);
// 访问控制：申请人本人 → 200；无关员工 sunqi（非链内）→ 403；管理员 → 403；lisi（链内）→ 200
r = await api(tokens.zhouba, 'GET', `/api/attachments/${attId}/content`);
check('S13.7 申请人本人可预览', r.status === 200 && (r.headers.get('content-type') || '').includes('png'));
r = await api(tokens.sunqi, 'GET', `/api/attachments/${attId}/content`);
check('S13.7b 非链内员工读取附件 403', r.status === 403);
r = await api(tokens.admin, 'GET', `/api/attachments/${attId}/content`);
check('S13.8 管理员默认无附件权限 403', r.status === 403);
await api(tokens.zhouba, 'POST', `/api/applications/${attAppId}/submit`);
await login('lisi', 'Lisi@123');
r = await api(tokens.lisi, 'GET', `/api/attachments/${attId}/content`);
check('S13.9 链内审批人可预览（image/png）', r.status === 200 && (r.headers.get('content-type') || '').includes('png'));
r = await api(tokens.lisi, 'GET', `/api/attachments/${attId}/download`);
check('S13.10 链内审批人可下载（attachment 头）', r.status === 200 && (r.headers.get('content-disposition') || '').includes('attachment'));
// 草稿限定：已提交后禁止删除附件；草稿删除附件后物理文件与记录一并清除
await login('zhouba', 'Zhouba@123');
c = await createApp(tokens.zhouba, PROC('E2E 删除测试', procItems(100, 200), [
  { supplierName: '甲', quoteAmountCents: 50000, selected: true },
  { supplierName: '乙', quoteAmountCents: 60000 },
]));
up = await upload(tokens.zhouba, c.data.id, 'QUOTATION', '临时.png', pngBytes(), 'image/png');
const tmpAtt = up.data.data.id;
await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/submit`);
r = await api(tokens.zhouba, 'DELETE', `/api/attachments/${tmpAtt}`);
check('S13.11 已提交申请禁止删除附件(409)', r.status === 409);
await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/withdraw`);
c = await createApp(tokens.zhouba, PROC('E2E 草稿删除附件', procItems(100, 200), [
  { supplierName: '甲', quoteAmountCents: 50000, selected: true },
  { supplierName: '乙', quoteAmountCents: 60000 },
]));
up = await upload(tokens.zhouba, c.data.id, 'QUOTATION', '临时2.png', pngBytes(), 'image/png');
const tmpAtt2 = up.data.data.id;
r = await api(tokens.zhouba, 'DELETE', `/api/attachments/${tmpAtt2}`);
check('S13.12 草稿阶段可删除附件', r.status === 200, errMsg(r));
r = await api(tokens.zhouba, 'GET', `/api/attachments/${tmpAtt2}/content`);
check('S13.13 删除后附件不可访问(404)', r.status === 404);
r = await api(tokens.zhouba, 'DELETE', `/api/applications/${c.data.id}`);
check('S13.14 草稿申请可删除（含附件清理）', r.status === 200, errMsg(r));

console.log('--- S14 任务/通知 ---');
await login('lisi', 'Lisi@123');
r = await api(tokens.lisi, 'GET', '/api/tasks?scope=todo');
check('S14.1 待办列表含当前节点任务', Array.isArray(r.data.data) && r.data.data.length >= 1);
r = await api(tokens.lisi, 'GET', '/api/tasks?scope=done');
check('S14.2 已办列表含历史审批', Array.isArray(r.data.data) && r.data.data.some((x) => x.my_action === 'APPROVE'));
// 非当前审批人操作 / 已处理实例重复操作
await login('zhouba', 'Zhouba@123');
c = await createApp(tokens.zhouba, PROC('E2E 任务校验', procItems(100, 200), [
  { supplierName: '甲', quoteAmountCents: 50000, selected: true },
  { supplierName: '乙', quoteAmountCents: 60000 },
]));
s = await submit(tokens.zhouba, c.data.id);
d = await detail(tokens.zhouba, c.data.id);
await login('wangwu', 'Wangwu@123');
ap = await approve(tokens.wangwu, d.data.instance.id, '非当前审批人');
check('S14.3 非当前审批人操作被拒(403)', ap.status === 403, errMsg(ap));
await login('lisi', 'Lisi@123');
ap = await approve(tokens.lisi, d.data.instance.id, '同意');
let ap2 = await approve(tokens.lisi, d.data.instance.id, '重复点击');
check('S14.4 已处理实例重复审批被拒(4xx)', ap.status === 200 && ap2.status >= 400, `2nd=${ap2.status}`);
// 通知：未读/标记已读/全部已读
await login('zhouba', 'Zhouba@123');
r = await api(tokens.zhouba, 'GET', '/api/notifications?page=1&pageSize=50');
const notif = r.data.data;
check('S14.5 通知列表含未读数', notif.unread >= 1, `unread=${notif.unread}`);
const first = notif.list[0];
r = await api(tokens.zhouba, 'PATCH', `/api/notifications/${first.id}/read`);
check('S14.6 单条标记已读成功', r.status === 200);
r = await api(tokens.zhouba, 'GET', '/api/notifications/unread-count');
const unreadAfter = r.data.data.unread;
check('S14.7 未读数递减', unreadAfter === notif.unread - 1, `${unreadAfter} vs ${notif.unread - 1}`);
r = await api(tokens.zhouba, 'PATCH', '/api/notifications/read-all');
check('S14.8 全部已读', r.status === 200);
r = await api(tokens.zhouba, 'GET', '/api/notifications/unread-count');
check('S14.9 未读归零', r.data.data.unread === 0);
check('S14.10 通知含跳转链接', typeof first.link === 'string' && first.link.length > 0, first.link);
await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/withdraw`);

console.log('--- S15 统计口径 ---');
await login('zhouba', 'Zhouba@123');
r = await api(tokens.zhouba, 'GET', '/api/stats/personal');
const pstats = r.data.data;
check('S15.1 个人统计形状完整', ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN'].every((k) => k in pstats.byStatus) && pstats.monthlySubmitted.length === 6);
r = await api(tokens.zhouba, 'GET', '/api/stats/dept');
check('S15.2 普通员工部门统计 403', r.status === 403);
await login('zhangsan', 'Zhangsan@123');
r = await api(tokens.zhangsan, 'GET', '/api/stats/dept');
check('S15.3 部门负责人统计=本部门', r.status === 200 && r.data.data.scope.deptFilter === 1);
const zhangsanStats = r.data.data;
await login('wangwu', 'Wangwu@123');
r = await api(tokens.wangwu, 'GET', '/api/stats/dept');
check('S15.4 财务授权统计=报销+采购全部部门', r.status === 200 && JSON.stringify(r.data.data.scope.typeFilter) === JSON.stringify(['REIMBURSEMENT', 'PROCUREMENT']));
await login('zhaoliu', 'Zhaoliu@123');
r = await api(tokens.zhaoliu, 'GET', '/api/stats/dept');
check('S15.5 企业负责人授权统计=全部类型', r.status === 200 && r.data.data.byType.some((x) => x.type === 'TRAVEL'));
r = await api(tokens.admin, 'GET', '/api/admin/stats');
check('S15.6 管理员统计=全部部门', r.status === 200 && r.data.data.departments.length >= 4);
// 已通过金额精确口径：研发部 2143000；市场部 13600000（含阈值大额 12500000，草稿/驳回/撤回不计）
const deptSum = (stats, id) => {
  const row = stats.amountByDept.find((x) => x.dept_id === id);
  return row ? Number(row.approved_cents) : 0;
};
check('S15.7 研发部已通过金额=2143000 分', deptSum(zhangsanStats, 1) === 2143000, `got=${deptSum(zhangsanStats, 1)}`);
check('S15.8 部门负责人统计仅本部门（市场部不可见）', deptSum(zhangsanStats, 2) === 0 && zhangsanStats.amountByDept.every((x) => x.dept_id === 1));
await login('zhaoliu', 'Zhaoliu@123');
r = await api(tokens.zhaoliu, 'GET', '/api/stats/dept');
check('S15.9 企业口径下市场部=13600000 分（草稿/驳回/撤回排除）', deptSum(r.data.data, 2) === 13600000, `got=${deptSum(r.data.data, 2)}`);
check('S15.10 企业口径下研发部=2143000 分', deptSum(r.data.data, 1) === 2143000, `got=${deptSum(r.data.data, 1)}`);
check('S15.11 趋势数组 6 个月', r.data.data.trend.length === 6 && r.data.data.trend.every((x) => /^\d{4}-\d{2}$/.test(x.ym)));

console.log('--- S16 管理后台 ---');
await login('admin', 'Admin@123');
r = await api(tokens.admin, 'GET', '/api/admin/users?keyword=zhou&page=1&pageSize=10');
check('S16.1 用户筛选 keyword=zhou', r.status === 200 && r.data.data.list.length === 1 && r.data.data.list[0].username === 'zhouba');
r = await api(tokens.admin, 'PATCH', `/api/admin/users/${users[uname].id}`, { body: { deptId: 3 } });
check('S16.2 调整用户部门', r.status === 200);
r = await api(tokens.admin, 'PATCH', `/api/admin/users/${users[uname].id}`, { body: { status: 'DISABLED' } });
check('S16.3 停用用户', r.status === 200);
r = await api(null, 'POST', '/api/auth/login', { body: { account: uname, password: 'E2ePass123' } });
check('S16.4 停用用户登录被拒(401)', r.status === 401);
await api(tokens.admin, 'PATCH', `/api/admin/users/${users[uname].id}`, { body: { status: 'ACTIVE' } });
r = await api(tokens.admin, 'POST', '/api/admin/departments', { body: { name: 'E2E临时部门', description: '测试' } });
const tmpDeptId = r.data.data.id;
r = await api(tokens.admin, 'GET', '/api/admin/departments');
check('S16.5 部门创建成功', r.status === 200 && r.data.data.some((x) => x.id === tmpDeptId));
r = await api(tokens.admin, 'PATCH', `/api/admin/departments/${tmpDeptId}`, { body: { name: 'E2E临时部门2', description: '改' } });
check('S16.6 部门改名', r.status === 200);
r = await api(tokens.admin, 'DELETE', `/api/admin/departments/${tmpDeptId}`);
check('S16.7 空部门删除', r.status === 200);
r = await api(tokens.admin, 'DELETE', '/api/admin/departments/3');
check('S16.8 有用户的部门禁止删除(409)', r.status === 409);
r = await api(tokens.admin, 'GET', '/api/admin/templates');
check('S16.9 模板列表（3 内置+2 种子自定义+1 E2E）', r.status === 200 && r.data.data.length >= 6);
// 启停种子模板影响员工可见性
await login('zhouba', 'Zhouba@123');
r = await api(tokens.zhouba, 'GET', '/api/templates/published');
const hasLeave = r.data.data.custom.some((x) => x.code === 'custom_leave');
await login('admin', 'Admin@123');
const leaveRow = (await api(tokens.admin, 'GET', '/api/admin/templates')).data.data.find((x) => x.code === 'custom_leave' && x.status === 'PUBLISHED');
r = await api(tokens.admin, 'POST', `/api/admin/templates/${leaveRow.id}/toggle`);
check('S16.10 停用模板', r.status === 200);
await login('zhouba', 'Zhouba@123');
r = await api(tokens.zhouba, 'GET', '/api/templates/published');
const hasLeaveOff = r.data.data.custom.some((x) => x.code === 'custom_leave');
check('S16.11 停用后员工不可见', hasLeave && !hasLeaveOff);
await login('admin', 'Admin@123');
r = await api(tokens.admin, 'POST', `/api/admin/templates/${leaveRow.id}/toggle`);
check('S16.12 重新启用', r.status === 200);
// 配置
r = await api(tokens.admin, 'GET', '/api/admin/config');
check('S16.13 配置项读取', r.status === 200 && r.data.data.some((x) => x.key === 'company_head_threshold_cents'));
r = await api(tokens.admin, 'PATCH', '/api/admin/config', { body: { remind_timeout_hours: 0.02 } });
check('S16.14 修改配置（催办阈值）', r.status === 200);
r = await api(tokens.admin, 'PATCH', '/api/admin/config', { body: { not_a_key: 1 } });
check('S16.15 白名单外配置键被拒', r.status === 400);
await api(tokens.admin, 'PATCH', '/api/admin/config', { body: { remind_timeout_hours: 48 } });
// 审计
r = await api(tokens.admin, 'GET', '/api/admin/audit-logs?page=1&pageSize=10');
check('S16.16 审计日志非空', r.status === 200 && r.data.data.total >= 5, `total=${r.data.data.total}`);
r = await api(tokens.admin, 'GET', '/api/admin/audit-logs?keyword=GRANT_ROLE&page=1&pageSize=10');
check('S16.17 审计日志关键字筛选', r.data.data.total >= 1);
// 统计授权增删的影响
await login('wangwu', 'Wangwu@123');
await login('admin', 'Admin@123');
r = await api(tokens.admin, 'GET', '/api/admin/stats-grants');
const wangwuGrant = r.data.data.find((x) => x.username === 'wangwu');
check('S16.18 种子统计授权存在', !!wangwuGrant);
r = await api(tokens.admin, 'DELETE', `/api/admin/stats-grants/${wangwuGrant.id}`);
check('S16.19 撤销财务统计授权', r.status === 200);
await login('wangwu', 'Wangwu@123');
r = await api(tokens.wangwu, 'GET', '/api/stats/dept');
check('S16.20 撤销后财务统计 403', r.status === 403);
await login('admin', 'Admin@123');
r = await api(tokens.admin, 'POST', '/api/admin/stats-grants', { body: { userId: 4, scope: 'FINANCE' } });
check('S16.21 重新授权', r.status === 200);
await login('wangwu', 'Wangwu@123');
r = await api(tokens.wangwu, 'GET', '/api/stats/dept');
check('S16.22 重新授权后恢复', r.status === 200);

console.log('--- S17 模板版本演进 ---');
await login('admin', 'Admin@123');
r = await api(tokens.admin, 'PUT', `/api/admin/templates/${tplId}`, { body: tplBody({ name: 'E2E 用章申请 v2' }) });
const tplV2 = r.data.data.id;
check('S17.1 编辑已发布模板生成新版本草稿', tplV2 !== tplId, `v1=${tplId} v2draft=${tplV2}`);
r = await api(tokens.admin, 'POST', `/api/admin/templates/${tplV2}/publish`);
check('S17.2 发布 v2', r.status === 200);
r = await api(tokens.admin, 'GET', '/api/admin/templates');
const v2Published = r.data.data.some((x) => x.id === tplV2 && x.status === 'PUBLISHED' && x.version === 2);
const v1Disabled = r.data.data.some((x) => x.id === tplId && x.status === 'DISABLED');
check('S17.3 v2 PUBLISHED 且 v1 自动停用', v2Published && v1Disabled, `v2=${v2Published} v1off=${v1Disabled}`);

if (SLOW) {
  console.log('--- S18 超时催办（慢场景） ---');
  await login('admin', 'Admin@123');
  await api(tokens.admin, 'PATCH', '/api/admin/config', { body: { remind_timeout_hours: 0.02 } });
  await login('zhouba', 'Zhouba@123');
  c = await createApp(tokens.zhouba, PROC('E2E 催办等待', procItems(100, 200), [
    { supplierName: '甲', quoteAmountCents: 50000, selected: true },
    { supplierName: '乙', quoteAmountCents: 60000 },
  ]));
  s = await submit(tokens.zhouba, c.data.id);
  check('S18.1 提交成功', s.status === 200, s.err);
  await login('lisi', 'Lisi@123');
  await api(tokens.lisi, 'PATCH', '/api/notifications/read-all');
  // 后台催办扫描间隔 60s、阈值 0.02h≈72s，最坏情况约在提交后 120~180s 才触发，
  // 等 200s 保证必有一次扫描命中。
  await sleep(200 * 1000);
  r = await api(tokens.lisi, 'GET', '/api/notifications/unread-count');
  check('S18.2 超时催办产生通知（阈值 0.02h）', r.data.data.unread >= 1, `unread=${r.data.data.unread}`);
  await login('admin', 'Admin@123');
  await api(tokens.admin, 'PATCH', '/api/admin/config', { body: { remind_timeout_hours: 48 } });
  await login('zhouba', 'Zhouba@123');
  await api(tokens.zhouba, 'POST', `/api/applications/${c.data.id}/withdraw`);
}

/* ------------------------------ 汇总 ------------------------------ */
const failed = results.filter((x) => !x.ok);
console.log(`\n===== E2E 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log(`  - ${f.name}  ${f.extra}`);
  process.exit(1);
}
process.exit(0);
