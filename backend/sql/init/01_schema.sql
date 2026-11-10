-- ============================================================
-- 企业审批系统 数据库结构（MySQL 8.0，utf8mb4，时区 +08:00）
-- 对应《设计文档》§4 数据库设计。首次启动由 docker-entrypoint-initdb.d 自动执行。
-- ============================================================
SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS approval_db DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE approval_db;

-- ---------- 部门 ----------
CREATE TABLE IF NOT EXISTS departments (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(50)  NOT NULL COMMENT '部门名称',
  description VARCHAR(200) NOT NULL DEFAULT '' COMMENT '描述',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB COMMENT='部门';

-- ---------- 角色 ----------
CREATE TABLE IF NOT EXISTS roles (
  id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(30)  NOT NULL COMMENT '角色编码 EMPLOYEE/DEPT_HEAD/FINANCE/COMPANY_HEAD/ADMIN',
  name VARCHAR(50)  NOT NULL COMMENT '角色名称',
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code)
) ENGINE=InnoDB COMMENT='角色';

-- ---------- 用户 ----------
CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username       VARCHAR(20)  NOT NULL COMMENT '登录名（唯一）',
  email          VARCHAR(128) NOT NULL COMMENT '邮箱（唯一）',
  password_hash  VARCHAR(100) NOT NULL COMMENT 'bcrypt 哈希（≥8位密码，服务端校验）',
  name           VARCHAR(32)  NOT NULL COMMENT '姓名',
  dept_id        INT UNSIGNED NULL COMMENT '所属部门（注册选择，须管理员确认后生效）',
  dept_confirmed TINYINT      NOT NULL DEFAULT 0 COMMENT '部门归属是否经管理员确认（未确认不能提交申请）',
  status         ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username),
  UNIQUE KEY uk_email (email),
  KEY idx_dept (dept_id),
  CONSTRAINT fk_users_dept FOREIGN KEY (dept_id) REFERENCES departments (id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='用户';

-- ---------- 用户-角色（多对多） ----------
CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT UNSIGNED NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='用户角色关联';

-- ---------- 流程模板（版本化：发布即新版本，草稿编辑，旧版停用） ----------
CREATE TABLE IF NOT EXISTS process_templates (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code             VARCHAR(50)  NOT NULL COMMENT '模板编码（内置 procurement/travel/reimbursement；自定义 custom_xxx）',
  name             VARCHAR(100) NOT NULL COMMENT '模板名称',
  description      VARCHAR(300) NOT NULL DEFAULT '',
  category         ENUM('BUILTIN','CUSTOM') NOT NULL DEFAULT 'CUSTOM',
  applicable_depts JSON         NOT NULL COMMENT '适用部门 id 数组，空数组=全部部门',
  form_schema      JSON         NOT NULL COMMENT '表单字段定义（字段类型/必填/校验/显示条件）',
  flow_config      JSON         NOT NULL COMMENT '审批节点定义（≥2 节点，规则 DEPT_HEAD/FINANCE/COMPANY_HEAD/SPECIFIED_USER）',
  version          INT          NOT NULL DEFAULT 1 COMMENT '版本号（发布时 +1）',
  status           ENUM('DRAFT','PUBLISHED','DISABLED') NOT NULL DEFAULT 'DRAFT',
  created_by       INT UNSIGNED NULL COMMENT '创建人（管理员）',
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_code_status (code, status),
  CONSTRAINT fk_tpl_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='审批流程模板（含版本）';

-- ---------- 申请主表 ----------
CREATE TABLE IF NOT EXISTS applications (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  app_no                VARCHAR(30)  NOT NULL COMMENT '申请编号：{CG|CX|BX|SP}{YYYYMMDD}-{4位序号}（服务端生成，唯一）',
  type                  ENUM('PROCUREMENT','TRAVEL','REIMBURSEMENT','CUSTOM') NOT NULL COMMENT '申请类型',
  template_id           INT UNSIGNED NULL COMMENT '流程模板 id（内置流程也有模板行）',
  template_version      INT          NULL COMMENT '提交时的模板版本（快照隔离：后续配置变更不影响本单）',
  applicant_id          INT UNSIGNED NOT NULL,
  dept_id               INT UNSIGNED NULL COMMENT '申请人提交时部门（口径快照）',
  title                 VARCHAR(100) NOT NULL,
  form_data             JSON         NOT NULL COMMENT '表单数据快照（提交时最终版）',
  status                ENUM('DRAFT','IN_APPROVAL','APPROVED','REJECTED','WITHDRAWN') NOT NULL DEFAULT 'DRAFT' COMMENT '状态机（§6）',
  total_amount_cents    BIGINT       NOT NULL DEFAULT 0 COMMENT '金额合计（分，服务端重算）',
  source_application_id INT UNSIGNED NULL COMMENT '复制重提来源单',
  linked_application_id INT UNSIGNED NULL COMMENT '报销关联的已批准差旅/采购单',
  current_instance_id   INT UNSIGNED NULL COMMENT '当前流程实例（审批流转用）',
  submitted_at          DATETIME     NULL COMMENT '提交时间（统计口径）',
  finished_at           DATETIME     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_app_no (app_no),
  KEY idx_applicant_status (applicant_id, status),
  KEY idx_status (status),
  KEY idx_dept (dept_id),
  KEY idx_submitted (submitted_at),
  KEY idx_template (template_id),
  KEY idx_linked (linked_application_id),
  CONSTRAINT fk_app_applicant FOREIGN KEY (applicant_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_app_template FOREIGN KEY (template_id) REFERENCES process_templates (id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='申请主表';

-- ---------- 采购明细（≥2 条） ----------
CREATE TABLE IF NOT EXISTS procurement_items (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id   INT UNSIGNED NOT NULL,
  name             VARCHAR(100) NOT NULL COMMENT '物品/服务名称',
  spec             VARCHAR(100) NOT NULL DEFAULT '',
  quantity         DECIMAL(12,3) NOT NULL COMMENT '数量',
  unit             VARCHAR(20)  NOT NULL COMMENT '单位',
  unit_price_cents BIGINT       NOT NULL COMMENT '预计单价（分）',
  amount_cents     BIGINT       NOT NULL COMMENT '小计（分，服务端重算）',
  PRIMARY KEY (id),
  KEY idx_app (application_id),
  CONSTRAINT fk_pci_app FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='采购明细';

-- ---------- 报价单（≥2 家或单一来源说明） ----------
CREATE TABLE IF NOT EXISTS quotations (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id    INT UNSIGNED NOT NULL,
  supplier_name     VARCHAR(100) NOT NULL,
  quote_date        DATE         NOT NULL,
  quote_amount_cents BIGINT      NOT NULL COMMENT '报价金额（分）',
  quote_detail      VARCHAR(500) NOT NULL DEFAULT '',
  purchase_link     VARCHAR(300) NOT NULL DEFAULT '' COMMENT '线上购买链接（线上必填）',
  online            TINYINT      NOT NULL DEFAULT 0 COMMENT '是否线上采购',
  attachment_ids    JSON         NOT NULL COMMENT '报价依据附件 id 数组（线上必填）',
  selected          TINYINT      NOT NULL DEFAULT 0 COMMENT '拟选供应商（必须且仅 1 家）',
  is_single_source  TINYINT      NOT NULL DEFAULT 0 COMMENT '单一来源采购标记',
  PRIMARY KEY (id),
  KEY idx_app (application_id),
  CONSTRAINT fk_qt_app FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='报价单';

-- ---------- 报销明细（≥3 条，5 类费用） ----------
CREATE TABLE IF NOT EXISTS expense_items (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id    INT UNSIGNED NOT NULL,
  expense_type      ENUM('TRAFFIC','HOTEL','MEAL','OFFICE','OTHER') NOT NULL COMMENT '费用类型（交通/住宿/餐饮/办公/其他）',
  occur_date        DATE         NOT NULL,
  purpose           VARCHAR(200) NOT NULL COMMENT '用途说明',
  amount_cents      BIGINT       NOT NULL COMMENT '金额（分，>0）',
  receipt_no        VARCHAR(64)  NULL COMMENT '票据号码（跨单重复预警依据之一）',
  no_receipt        TINYINT      NOT NULL DEFAULT 0 COMMENT '无票支出标记（必须填原因，财务界面突出显示）',
  no_receipt_reason VARCHAR(200) NULL COMMENT '无票原因',
  PRIMARY KEY (id),
  KEY idx_app (application_id),
  KEY idx_receipt_no (receipt_no),
  CONSTRAINT fk_ei_app FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='报销费用明细';

-- ---------- 附件（JPEG/PNG/PDF，单文件 ≤10MB；同文件 MD5 去重预警依据） ----------
CREATE TABLE IF NOT EXISTS attachments (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id INT UNSIGNED NOT NULL,
  biz_type       ENUM('QUOTATION','TRAVEL','RECEIPT','CUSTOM') NOT NULL COMMENT '业务类型（服务端校验与申请类型一致）',
  original_name  VARCHAR(255) NOT NULL,
  stored_name    VARCHAR(100) NOT NULL COMMENT '磁盘随机文件名',
  mime           VARCHAR(100) NOT NULL,
  size_bytes     BIGINT       NOT NULL,
  md5            CHAR(32)     NOT NULL COMMENT '文件 MD5（跨单重复票据预警）',
  uploaded_by    INT UNSIGNED NOT NULL,
  uploaded_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_app (application_id),
  KEY idx_stored (stored_name),
  KEY idx_md5 (md5),
  CONSTRAINT fk_att_app FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE,
  CONSTRAINT fk_att_user FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='附件';

-- ---------- 票据关联（明细 ↔ 附件） ----------
CREATE TABLE IF NOT EXISTS receipts (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id   INT UNSIGNED NOT NULL,
  expense_item_id  INT UNSIGNED NOT NULL,
  attachment_id    INT UNSIGNED NOT NULL,
  receipt_no       VARCHAR(64)  NULL,
  PRIMARY KEY (id),
  KEY idx_app (application_id),
  KEY idx_att (attachment_id),
  KEY idx_item (expense_item_id),
  CONSTRAINT fk_rc_app FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE,
  CONSTRAINT fk_rc_item FOREIGN KEY (expense_item_id) REFERENCES expense_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_rc_att FOREIGN KEY (attachment_id) REFERENCES attachments (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='票据-明细-附件关联';

-- ---------- 流程实例（提交时生成；flow_snapshot 为审批链快照） ----------
CREATE TABLE IF NOT EXISTS process_instances (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id      INT UNSIGNED NOT NULL,
  template_id         INT UNSIGNED NULL,
  template_version    INT          NULL,
  flow_snapshot       JSON         NOT NULL COMMENT '节点快照：{nodes:[{idx,name,rule,resolved_user_id,delegated_from}],thresholdCents,builtin}',
  current_node_idx    INT          NOT NULL DEFAULT 0 COMMENT '当前节点下标（顺序审批，单调推进）',
  current_approver_id INT UNSIGNED NULL COMMENT '当前节点实际审批人',
  status              ENUM('IN_APPROVAL','APPROVED','REJECTED','WITHDRAWN') NOT NULL DEFAULT 'IN_APPROVAL',
  total_amount_cents  BIGINT       NOT NULL DEFAULT 0,
  submitted_at        DATETIME     NOT NULL,
  finished_at         DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_app (application_id),
  KEY idx_todo (status, current_approver_id),
  CONSTRAINT fk_pi_app FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_template FOREIGN KEY (template_id) REFERENCES process_templates (id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='流程实例（审批链快照）';

-- ---------- 审批记录（不可变日志） ----------
CREATE TABLE IF NOT EXISTS approval_records (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  instance_id       INT UNSIGNED NOT NULL,
  application_id    INT UNSIGNED NOT NULL,
  node_idx          INT          NOT NULL COMMENT '节点下标（-1=提交）',
  node_name         VARCHAR(100) NOT NULL DEFAULT '',
  approver_user_id  INT UNSIGNED NULL COMMENT '节点实际审批人（快照）',
  acted_by          INT UNSIGNED NOT NULL COMMENT '操作人',
  action            ENUM('SUBMIT','APPROVE','REJECT','WITHDRAW') NOT NULL,
  comment           VARCHAR(1000) NULL COMMENT '审批意见/驳回理由/撤回说明',
  result            ENUM('PASS','REJECT','WITHDRAW') NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_instance (instance_id),
  KEY idx_app (application_id),
  KEY idx_acted (acted_by),
  CONSTRAINT fk_ar_instance FOREIGN KEY (instance_id) REFERENCES process_instances (id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_app FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_acted FOREIGN KEY (acted_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='审批记录（不可变）';

-- ---------- 站内通知（UNIQUE(user_id,biz_key) + INSERT IGNORE 防重） ----------
CREATE TABLE IF NOT EXISTS notifications (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  type       ENUM('TODO','APPROVED','REJECTED','WITHDRAWN','REMIND','SYSTEM') NOT NULL,
  title      VARCHAR(100) NOT NULL,
  content    VARCHAR(500) NOT NULL DEFAULT '',
  link       VARCHAR(200) NOT NULL DEFAULT '' COMMENT '前端跳转路径',
  biz_key    VARCHAR(160) NOT NULL DEFAULT '' COMMENT '业务幂等键（防重复通知）',
  is_read    TINYINT      NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_biz (user_id, biz_key),
  KEY idx_user_read (user_id, is_read, id),
  CONSTRAINT fk_ntf_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='站内通知';

-- ---------- 审批委托 ----------
CREATE TABLE IF NOT EXISTS delegations (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED NOT NULL COMMENT '委托人',
  delegatee_id INT UNSIGNED NOT NULL COMMENT '受托人',
  start_time   DATETIME     NOT NULL,
  end_time     DATETIME     NOT NULL,
  enabled      TINYINT      NOT NULL DEFAULT 1,
  reason       VARCHAR(200) NOT NULL DEFAULT '',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user (user_id, enabled, start_time, end_time),
  CONSTRAINT fk_dl_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_dl_delegatee FOREIGN KEY (delegatee_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='审批委托';

-- ---------- 统计授权（FINANCE/COMPANY 口径明确授权） ----------
CREATE TABLE IF NOT EXISTS stats_grants (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  scope      ENUM('FINANCE','COMPANY') NOT NULL COMMENT 'FINANCE=报销+采购全部门统计；COMPANY=全部部门全部类型',
  granted_by INT UNSIGNED NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_scope (user_id, scope),
  CONSTRAINT fk_sg_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_sg_granter FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='统计授权';

-- ---------- Web Push 订阅 ----------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  endpoint   VARCHAR(500) NOT NULL,
  p256dh     VARCHAR(200) NOT NULL,
  auth       VARCHAR(100) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_endpoint (user_id, endpoint),
  CONSTRAINT fk_ps_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Web Push 订阅';

-- ---------- 管理员操作审计日志 ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  operator_id INT UNSIGNED NULL,
  action      VARCHAR(50)  NOT NULL COMMENT '操作类型（ENABLE_USER/DISABLE_USER/CHANGE_DEPT/CONFIRM_DEPT/GRANT_ROLE/PUBLISH_TEMPLATE/UPDATE_CONFIG/GRANT_STATS…）',
  target_type VARCHAR(30)  NOT NULL DEFAULT '',
  target_id   VARCHAR(50)  NOT NULL DEFAULT '',
  detail      JSON         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_created (created_at),
  CONSTRAINT fk_al_operator FOREIGN KEY (operator_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='管理员操作审计日志（不可变）';

-- ---------- 系统配置 ----------
CREATE TABLE IF NOT EXISTS system_configs (
  `key`       VARCHAR(50)  NOT NULL,
  value       VARCHAR(200) NOT NULL,
  description VARCHAR(200) NOT NULL DEFAULT '',
  PRIMARY KEY (`key`)
) ENGINE=InnoDB COMMENT='系统配置';

-- ---------- 申请编号序号表（行锁保证唯一；applications.app_no 唯一索引兜底） ----------
CREATE TABLE IF NOT EXISTS app_no_seq (
  `type` VARCHAR(30) NOT NULL COMMENT '申请类型 PROCUREMENT/TRAVEL/REIMBURSEMENT/CUSTOM',
  `date` CHAR(8)     NOT NULL COMMENT 'YYYYMMDD',
  seq    INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (`type`, `date`)
) ENGINE=InnoDB COMMENT='申请编号当日序号';
