-- ============================================================
-- 初始化演示数据（可重复执行：先清空再插入；密码均为 bcrypt 哈希）
-- 演示账号（密码规则：≥8位，含大小写/数字/符号）：
--   admin   / Admin@123     系统管理员（管理部）
--   zhangsan/ Zhangsan@123  研发部负责人
--   lisi    / Lisi@123      市场部负责人
--   wangwu  / Wangwu@123    财务（财务部）
--   zhaoliu / Zhaoliu@123   企业负责人（管理部）
--   sunqi   / Sunqi@123     研发部员工
--   zhouba  / Zhouba@123    市场部员工
--   wujiu   / Wujiu@123     财务部员工
-- ============================================================
USE approval_db;
SET NAMES utf8mb4;

DELETE FROM audit_logs;
DELETE FROM stats_grants;
DELETE FROM push_subscriptions;
DELETE FROM notifications;
DELETE FROM approval_records;
DELETE FROM process_instances;
DELETE FROM receipts;
DELETE FROM expense_items;
DELETE FROM quotations;
DELETE FROM procurement_items;
DELETE FROM attachments;
DELETE FROM applications;
DELETE FROM delegations;
DELETE FROM process_templates;
DELETE FROM user_roles;
DELETE FROM users;
DELETE FROM roles;
DELETE FROM departments;
DELETE FROM app_no_seq;
DELETE FROM system_configs;

-- ---------- 部门 ----------
INSERT INTO departments (id, name, description) VALUES
  (1, '研发部', '产品研发与技术支撑'),
  (2, '市场部', '市场推广与销售'),
  (3, '财务部', '财务核算与资金管理'),
  (4, '管理部', '行政与综合管理');

-- ---------- 角色 ----------
INSERT INTO roles (id, code, name) VALUES
  (1, 'EMPLOYEE', '普通员工'),
  (2, 'DEPT_HEAD', '部门负责人'),
  (3, 'FINANCE', '财务'),
  (4, 'COMPANY_HEAD', '企业负责人'),
  (5, 'ADMIN', '系统管理员');

-- ---------- 用户（bcrypt 哈希；dept_confirmed=1 表示部门归属已确认） ----------
INSERT INTO users (id, username, email, password_hash, name, dept_id, dept_confirmed, status) VALUES
  (1, 'admin',    'admin@example.com',    '$2a$10$GLoemdqNB4UMOZi.JTz3COBLYQf6/90.eSabYcbCjIFqz/OrvlRAq', '系统管理员', 4, 1, 'ACTIVE'),
  (2, 'zhangsan', 'zhangsan@example.com', '$2a$10$peSz8K2nHWj778zMluoLHuD48fhT8ZbBZzdy1OIA3xhvI1QoZLk12', '张三', 1, 1, 'ACTIVE'),
  (3, 'lisi',     'lisi@example.com',     '$2a$10$NNrTwd2v8q2Q9YcaMoKLFO1tudC2MVifvIGdZJxmBe1P8E9BxKd8a', '李四', 2, 1, 'ACTIVE'),
  (4, 'wangwu',   'wangwu@example.com',   '$2a$10$Lae4YXlXsxaJdmrcka0zg.7PHvjLxr1EFSjx4tjrGrxLXlzP6sSfS', '王五', 3, 1, 'ACTIVE'),
  (5, 'zhaoliu',  'zhaoliu@example.com',  '$2a$10$LCdh/AySs5oCIaiQvui1Uev8spJHQW0iSJUOeVqQOnP66xgooLPEa', '赵六', 4, 1, 'ACTIVE'),
  (6, 'sunqi',    'sunqi@example.com',    '$2a$10$NfYSDipUHcg9Y8F9ntobzeFTJvyc3mjjrM0b8KKTWgYMaQDjy9xyC', '孙七', 1, 1, 'ACTIVE'),
  (7, 'zhouba',   'zhouba@example.com',   '$2a$10$SSSKPFm50010C5tytIY36eM/micBNyipEWNKB/AYxyO3/GW2RpcCa', '周八', 2, 1, 'ACTIVE'),
  (8, 'wujiu',    'wujiu@example.com',    '$2a$10$wlgai0/anfUc914w1VM2uuKs62zZC84MPibRLukvDn9uTlpO5Zune', '吴九', 3, 1, 'ACTIVE');

-- ---------- 用户-角色 ----------
INSERT INTO user_roles (user_id, role_id) VALUES
  (1, 5),                                       -- admin：系统管理员
  (2, 1), (2, 2),                               -- zhangsan：员工 + 研发部负责人
  (3, 1), (3, 2),                               -- lisi：员工 + 市场部负责人
  (4, 1), (4, 3),                               -- wangwu：员工 + 财务
  (5, 1), (5, 4),                               -- zhaoliu：员工 + 企业负责人
  (6, 1), (7, 1), (8, 1);                       -- 普通员工

-- ---------- 内置流程模板（对应三类申请；审批链与后端内置逻辑一致） ----------
INSERT INTO process_templates (id, code, name, description, category, applicable_depts, form_schema, flow_config, version, status, created_by) VALUES
  (1, 'procurement', '采购申请', '采购申请流程：部门负责人审批 → 财务预算审查（≥阈值加签企业负责人）', 'BUILTIN', JSON_ARRAY(),
   JSON_OBJECT('fields', JSON_ARRAY(
     JSON_OBJECT('id', 'reason', 'label', '采购原因', 'type', 'textarea', 'required', true),
     JSON_OBJECT('id', 'expected_arrival_date', 'label', '期望到货日期', 'type', 'date', 'required', true),
     JSON_OBJECT('id', 'items', 'label', '采购明细（≥2条）', 'type', 'text', 'required', true),
     JSON_OBJECT('id', 'quotations', 'label', '报价单（≥2家或单一来源说明）', 'type', 'text', 'required', true))),
   JSON_OBJECT('nodes', JSON_ARRAY(
     JSON_OBJECT('name', '部门负责人审批', 'rule', JSON_OBJECT('type', 'DEPT_HEAD')),
     JSON_OBJECT('name', '财务预算审查', 'rule', JSON_OBJECT('type', 'FINANCE')))),
   1, 'PUBLISHED', 1),
  (2, 'travel', '差旅申请', '差旅申请流程：部门负责人审批（≥阈值加签企业负责人）', 'BUILTIN', JSON_ARRAY(),
   JSON_OBJECT('fields', JSON_ARRAY(
     JSON_OBJECT('id', 'destination', 'label', '目的地', 'type', 'text', 'required', true),
     JSON_OBJECT('id', 'start_time', 'label', '开始时间', 'type', 'date', 'required', true),
     JSON_OBJECT('id', 'end_time', 'label', '结束时间', 'type', 'date', 'required', true))),
   JSON_OBJECT('nodes', JSON_ARRAY(
     JSON_OBJECT('name', '部门负责人审批', 'rule', JSON_OBJECT('type', 'DEPT_HEAD')))),
   1, 'PUBLISHED', 1),
  (3, 'reimbursement', '报销申请', '报销申请流程：部门负责人审批 → 财务审核（票据）（≥阈值加签企业负责人）', 'BUILTIN', JSON_ARRAY(),
   JSON_OBJECT('fields', JSON_ARRAY(
     JSON_OBJECT('id', 'description', 'label', '报销说明', 'type', 'textarea', 'required', true),
     JSON_OBJECT('id', 'expense_items', 'label', '费用明细（≥3条，5类费用）', 'type', 'text', 'required', true))),
   JSON_OBJECT('nodes', JSON_ARRAY(
     JSON_OBJECT('name', '部门负责人审批', 'rule', JSON_OBJECT('type', 'DEPT_HEAD')),
     JSON_OBJECT('name', '财务审核（票据）', 'rule', JSON_OBJECT('type', 'FINANCE')))),
   1, 'PUBLISHED', 1);

-- ---------- 自定义流程模板（演示：请假申请、用章申请） ----------
INSERT INTO process_templates (id, code, name, description, category, applicable_depts, form_schema, flow_config, version, status, created_by) VALUES
  (4, 'custom_leave', '请假申请', '自定义流程演示：请假申请（部门负责人 → 企业负责人），含条件显隐字段', 'CUSTOM', JSON_ARRAY(),
   JSON_OBJECT('fields', JSON_ARRAY(
     JSON_OBJECT('id', 'start_date', 'label', '开始日期', 'type', 'date', 'required', true),
     JSON_OBJECT('id', 'end_date', 'label', '结束日期', 'type', 'date', 'required', true),
     JSON_OBJECT('id', 'leave_type', 'label', '请假类型', 'type', 'radio', 'required', true,
                 'options', JSON_ARRAY('事假', '病假', '年假', '调休')),
     JSON_OBJECT('id', 'days', 'label', '请假天数', 'type', 'number', 'required', true,
                 'rules', JSON_OBJECT('min', 0.5, 'max', 30)),
     JSON_OBJECT('id', 'reason', 'label', '请假事由', 'type', 'textarea', 'required', true),
     JSON_OBJECT('id', 'sick_note', 'label', '病假证明', 'type', 'attachment', 'required', false,
                 'condition', JSON_OBJECT('field', 'leave_type', 'op', 'eq', 'value', '病假')),
     JSON_OBJECT('id', 'attachment', 'label', '其他附件', 'type', 'attachment', 'required', false))),
   JSON_OBJECT('nodes', JSON_ARRAY(
     JSON_OBJECT('name', '部门负责人审批', 'rule', JSON_OBJECT('type', 'DEPT_HEAD')),
     JSON_OBJECT('name', '企业负责人审批', 'rule', JSON_OBJECT('type', 'COMPANY_HEAD')))),
   1, 'PUBLISHED', 1),
  (5, 'custom_seal', '用章申请', '自定义流程演示：用章申请（部门负责人 → 指定管理员复核）', 'CUSTOM', JSON_ARRAY(),
   JSON_OBJECT('fields', JSON_ARRAY(
     JSON_OBJECT('id', 'seal_type', 'label', '用章类型', 'type', 'radio', 'required', true,
                 'options', JSON_ARRAY('公章', '合同章', '财务章', '法人章')),
     JSON_OBJECT('id', 'doc_name', 'label', '文件名称', 'type', 'text', 'required', true),
     JSON_OBJECT('id', 'copies', 'label', '用章份数', 'type', 'number', 'required', true,
                 'rules', JSON_OBJECT('min', 1, 'max', 50)),
     JSON_OBJECT('id', 'use_date', 'label', '用章日期', 'type', 'date', 'required', true),
     JSON_OBJECT('id', 'purpose', 'label', '用途说明', 'type', 'textarea', 'required', true),
     JSON_OBJECT('id', 'attachment', 'label', '相关文件', 'type', 'attachment', 'required', false))),
   JSON_OBJECT('nodes', JSON_ARRAY(
     JSON_OBJECT('name', '部门负责人审批', 'rule', JSON_OBJECT('type', 'DEPT_HEAD')),
     JSON_OBJECT('name', '管理员复核', 'rule', JSON_OBJECT('type', 'SPECIFIED_USER', 'user_id', 1)))),
   1, 'PUBLISHED', 1);

-- ---------- 系统配置 ----------
INSERT INTO system_configs (`key`, value, description) VALUES
  ('company_head_threshold_cents', '10000000', '企业负责人加签金额阈值（分，默认 ¥100,000）'),
  ('receipt_max_count', '20', '单笔报销票据数量上限'),
  ('receipt_max_total_mb', '100', '单笔报销票据总大小上限（MB）'),
  ('receipt_max_size_mb', '10', '单个票据文件大小上限（MB）'),
  ('remind_timeout_hours', '48', '审批超时提醒时长（小时，演示可调小如 0.02）');

-- ---------- 统计授权（明确授权口径） ----------
INSERT INTO stats_grants (user_id, scope, granted_by) VALUES
  (4, 'FINANCE', 1),   -- wangwu：财务统计（报销+采购，全部部门）
  (5, 'COMPANY', 1);   -- zhaoliu：企业统计（全部部门全部类型）
