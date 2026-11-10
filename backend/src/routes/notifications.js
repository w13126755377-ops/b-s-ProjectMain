/**
 * 通知路由：列表/未读数/标记已读/全部已读 + SSE 实时流。
 * 读取与标记强制 user_id = 当前用户（非本人通知不可读不可标记）。
 * SSE 认证：先以 Header 认证换取 60 秒短期 ticket，EventSource 凭 ticket 建立连接
 * （7 天 JWT 不进入 URL，避免泄入 nginx 日志/浏览器历史）。
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { badRequest, notFound, ok, asyncHandler } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { config } from '../config.js';
import { addClient, removeClient } from '../utils/sse.js';
import { countUnread } from '../services/notificationService.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const listSchema = z.object({
  unread: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

notificationsRouter.get('/', validate({ query: listSchema }), asyncHandler(async (req, res) => {
  const where = ['user_id = ?'];
  const params = [req.user.id];
  if (req.query.unread === '1') where.push('is_read = 0');
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)));
  const [countRows] = await query(
    `SELECT COUNT(*) AS c FROM notifications WHERE ${where.join(' AND ')}`, params);
  const rows = await query(
    `SELECT id, type, title, content, link, is_read, created_at
     FROM notifications WHERE ${where.join(' AND ')}
     ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]);
  ok(res, { list: rows, total: countRows[0].c, unread: await countUnread(req.user.id), page, pageSize });
}));

notificationsRouter.get('/unread-count', asyncHandler(async (req, res) => {
  ok(res, { unread: await countUnread(req.user.id) });
}));

notificationsRouter.patch('/read-all', asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
  ok(res, { unread: 0 }, '已全部标记为已读');
}));

notificationsRouter.patch('/:id/read', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), asyncHandler(async (req, res) => {
  const n = await queryOne('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
  if (!n) throw notFound('通知不存在');
  if (n.user_id !== req.user.id) throw badRequest('只能操作本人的通知');
  await query('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
  ok(res, { unread: await countUnread(req.user.id) });
}));

/** 换取短期 SSE ticket（60 秒有效，仅用于 stream 端点） */
notificationsRouter.get('/stream-ticket', asyncHandler(async (req, res) => {
  const ticket = jwt.sign(
    { uid: req.user.id, scope: 'sse' },
    config.jwt.secret,
    { expiresIn: '60s' }
  );
  ok(res, { ticket });
}));

/** SSE 实时流（在 requireAuth 之后单独注册的路由，见 server.js；此处定义处理函数） */
export function handleSseStream(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 25000);
  addClient(req.user.id, res);
  // 连接建立即推送一次当前未读数，保证页面打开即最新
  countUnread(req.user.id).then((unread) => {
    try { res.write(`event: hello\ndata: ${JSON.stringify({ unread })}\n\n`); } catch {}
  });
  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(req.user.id, res);
  });
}
