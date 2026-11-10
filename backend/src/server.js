/**
 * 应用入口：Express 装配 + SSE 流路由 + 超时催办后台任务。
 *
 * 启动顺序：先等数据库可连接（重试），再监听端口，
 * 保证 docker-compose 中 mysql 容器晚就绪也能正常启动。
 */
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool, query, getSystemConfig } from './db.js';
import { errorMiddleware, notFound } from './errors.js';
import { loadUser } from './middleware/auth.js';

import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { departmentsRouter } from './routes/departments.js';
import { applicationsRouter } from './routes/applications.js';
import { tasksRouter } from './routes/tasks.js';
import { attachmentsRouter } from './routes/attachments.js';
import { notificationsRouter, handleSseStream } from './routes/notifications.js';
import { statsRouter } from './routes/stats.js';
import { templatesRouter } from './routes/templates.js';
import { delegationsRouter } from './routes/delegations.js';
import { pushRouter, configRouter } from './routes/push.js';
import { adminRouter } from './routes/admin.js';

import { createNotification, emitNotification, NOTIFY_TYPE } from './services/notificationService.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ---------- 业务路由 ---------- */
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/delegations', delegationsRouter);
app.use('/api/push', pushRouter);
app.use('/api/config', configRouter);
app.use('/api/admin', adminRouter);

/* ---------- SSE 实时流（EventSource 无法带 Header，凭 60 秒短期 ticket 认证） ---------- */
app.get('/api/notifications/stream', async (req, res) => {
  try {
    const token = req.query.token || '';
    if (!token) return res.status(401).json({ code: 401, message: '缺少连接票据' });
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch {
      return res.status(401).json({ code: 401, message: '连接票据已过期，正在重连' });
    }
    if (payload.scope !== 'sse') return res.status(401).json({ code: 401, message: '票据用途不正确' });
    const user = await loadUser(payload.uid);
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ code: 401, message: '用户无效' });
    req.user = user;
    handleSseStream(req, res);
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务异常' });
  }
});

/* ---------- 404 与错误处理 ---------- */
app.use((_req, _res, next) => next(notFound('接口不存在')));
app.use(errorMiddleware);

/* ================= 超时催办后台任务 =================
 * 扫描 IN_APPROVAL 实例，当前节点停留超过 remind_timeout_hours（默认 48h，演示可配 1 分钟）
 * 时向当前审批人发送催办通知。
 * 防重口径：biz_key = TIMEOUT:{instanceId}:{窗口序号}，每个超时窗口只催一次，
 * 持续超时会按窗口递增再次催办（UNIQUE(user_id,biz_key) 保证不重复）。
 */
async function runTimeoutRemind() {
  try {
    const timeoutHours = Number(await getSystemConfig('remind_timeout_hours')) || 48;
    if (timeoutHours <= 0) return;
    const instances = await query(
      `SELECT pi.id, pi.application_id, pi.current_approver_id,
              a.app_no, a.type, a.title
       FROM process_instances pi
       JOIN applications a ON a.id = pi.application_id
       WHERE pi.status = 'IN_APPROVAL' AND pi.current_approver_id IS NOT NULL`
    );
    for (const inst of instances) {
      // 当前节点起始时间 = 该实例最近一条审批记录（SUBMIT 或上一节点通过）时间
      const [last] = await query(
        `SELECT created_at FROM approval_records WHERE instance_id = ? ORDER BY id DESC LIMIT 1`,
        [inst.id]
      );
      if (!last) continue;
      const elapsedHours = (Date.now() - new Date(last.created_at).getTime()) / 3_600_000;
      if (elapsedHours < timeoutHours) continue;
      const windowIdx = Math.floor(elapsedHours / timeoutHours);
      const bizKey = `TIMEOUT:${inst.id}:${windowIdx}`;
      const inserted = await createNotification({
        userId: inst.current_approver_id,
        type: NOTIFY_TYPE.REMIND,
        title: '审批超时提醒',
        content: `您有申请「${inst.app_no} ${inst.title}」已超过 ${timeoutHours < 1 ? Math.round(timeoutHours * 60) + ' 分钟' : timeoutHours + ' 小时'}未处理，请及时审批`,
        link: `/apps/${inst.application_id}`,
        bizKey,
      });
      if (inserted) {
        const n = { userId: inst.current_approver_id, type: NOTIFY_TYPE.REMIND, title: '审批超时提醒' };
        emitNotification(inst.current_approver_id, n).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[timeout-remind] 扫描失败:', err.message);
  }
}

/* ---------- 启动 ---------- */
async function waitForDb(retries = 60, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('[db] 数据库连接成功');
      return;
    } catch (err) {
      console.log(`[db] 等待数据库就绪（${i + 1}/${retries}）: ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('数据库长时间不可用，请检查连接配置');
}

waitForDb()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`[server] 企业审批系统后端已启动: http://localhost:${config.port}`);
    });
    // 超时催办：每分钟扫描一次（演示可把 remind_timeout_hours 配成 0.02 即 1 分钟）
    setInterval(runTimeoutRemind, 60 * 1000);
    runTimeoutRemind();
  })
  .catch((err) => {
    console.error('[server] 启动失败:', err.message);
    process.exit(1);
  });

export { app };
