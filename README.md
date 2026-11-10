# 企业审批系统（BS 体系软件设计大程）

基于 B/S 架构的多角色企业审批系统：注册/登录、三类内置流程（采购/差旅/报销）+ 管理员自定义流程模板、状态机审批流转、站内通知与实时推送、统计报表、响应式移动端适配，Docker 一键部署。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + Vite + Pinia + Vue Router + Element Plus + ECharts + Axios，nginx 托管与反代 |
| 后端 | Node.js 20 + Express 4（ESM）+ mysql2 + bcryptjs + jsonwebtoken + multer + zod |
| 数据库 | MySQL 8.0（utf8mb4，时区 +08:00），结构/种子脚本见 `backend/sql/init/` |
| 部署 | Docker Compose（mysql + backend + frontend 三容器） |

## 快速开始（Docker）

```bash
# 可选：复制环境变量模板并按需修改（数据库密码、JWT 密钥、端口）
cp .env.example .env

docker compose up -d --build
# 访问 http://localhost:8080 （WEB_PORT 可改）
```

首次启动 MySQL 会自动执行 `backend/sql/init/01_schema.sql`（建表）与 `02_seed.sql`（演示数据）。数据与上传附件分别持久化在 `mysql_data` / `uploads` volume，`docker compose down` 不会丢失；如需重置演示数据：`docker compose down -v` 后重新启动。

### 本地开发

```bash
# 后端（需本机 MySQL，连接参数见 backend/.env.example）
cd backend && npm install && npm run dev   # 或 node src/server.js

# 前端（vite 开发服务器，/api 自动代理到 localhost:3000）
cd frontend && npm install && npm run dev  # http://localhost:5173
```

## 演示账号（密码规则 ≥8 位，均符合要求）

| 账号 | 密码 | 角色 | 部门 |
| --- | --- | --- | --- |
| admin | Admin@123 | 系统管理员 | 管理部 |
| zhangsan | Zhangsan@123 | 部门负责人 | 研发部 |
| lisi | Lisi@123 | 部门负责人 | 市场部 |
| wangwu | Wangwu@123 | 财务 | 财务部 |
| zhaoliu | Zhaoliu@123 | 企业负责人 | 管理部 |
| sunqi / zhouba / wujiu | Sunqi@123 等 | 普通员工 | 研发/市场/财务部 |

> 新注册用户默认为普通员工，部门归属须管理员在「管理后台 → 用户管理」中确认后才能提交申请；角色授予全部经管理员操作并写审计日志。

## 功能总览（对照作业要求）

- **基础**：注册/登录/退出/个人资料；我的申请/待办/已办/通知中心；管理后台（用户/部门/流程模板/系统配置/统计授权/审计日志/全公司统计）。
- **申请**：草稿保存/提交/详情/审批进度查看；类型/状态/时间/关键词筛选 + 分页；服务端生成唯一申请编号（如 `CG20261110-0001`）。
- **三类内置流程**：采购（≥2 明细、≥2 报价或单一来源说明、非最低价须说明、线上采购须链接+截图）；差旅（起止时间校验、系统按"自然日-时长折算"计算天数、可关联报销）；报销（≥3 明细 5 类费用、服务端整数"分"重算合计、每条明细 ≥1 票据或无票原因并在财务审核界面突出显示、JPEG/PNG/PDF ≤10MB、票据号/文件 MD5 跨单重复预警）。
- **自定义流程模板**：管理员可配置名称/描述/适用部门/版本/启停；字段类型 text/textarea/number/amount/date/radio/attachment（必填+校验+条件显隐）；≥2 个可排序节点，审批人规则至少支持指定用户与部门负责人；发布校验（字段标识唯一、条件引用无循环等）。
- **状态机与并发**：DRAFT → IN_APPROVAL → APPROVED/REJECTED/WITHDRAWN；提交时全量快照（后续配置修改不影响存量实例）；驳回必填理由；撤回/审批并发仅一方成功；不可自审批；重复点击/双浏览器双击幂等；审批日志与管理员操作审计日志不可变。
- **统计**：个人 + 部门口径（按提交时间；已通过金额不含草稿/驳回/撤回；≥1 图表）；部门统计按角色/明确授权（`stats_grants`）定范围。
- **通知**：新待办/通过/驳回/撤回持久化站内通知（未读数、标记已读、点击跳详情、幂等去重）；SSE 实时推送 + Web Push（可选）+ 30s 轮询兜底；超时催办后台任务 + 手动催办。
- **移动端**：全部核心操作响应式适配，页面打开即最新数据（SSE 刷新事件驱动）。

## 目录结构

```
├── docs/           设计文档.md、使用手册.md、实验报告.md
├── backend/        Express 后端（src/routes、src/services 审批引擎、sql/init 建库种子）
├── frontend/       Vue 3 前端（src/views、src/components、nginx.conf、Dockerfile）
├── docker-compose.yml
└── README.md
```

## 文档

- [docs/设计文档.md](docs/设计文档.md) — 需求分析、总体设计、数据库设计、审批引擎、安全、部署等 17 章
- [docs/使用手册.md](docs/使用手册.md) — 各角色操作指南
- [docs/实验报告.md](docs/实验报告.md) — 实现总结、测试、演示清单
