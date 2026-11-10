/** Web Push 订阅路由 + 公开配置 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { badRequest, ok, asyncHandler } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { config } from '../config.js';
import { pushConfigured } from '../services/pushService.js';

export const pushRouter = Router();
pushRouter.use(requireAuth);

const subSchema = z.object({
  endpoint: z.string().url('订阅地址无效'),
  keys: z.object({
    p256dh: z.string().min(10),
    auth: z.string().min(10),
  }),
});

pushRouter.post('/subscribe', validate({ body: subSchema }), asyncHandler(async (req, res) => {
  if (!pushConfigured()) throw badRequest('服务器未启用 Web Push（需要 HTTPS 或 localhost 环境并配置 VAPID）');
  const { endpoint, keys } = req.body;
  const exists = await queryOne(
    'SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
    [req.user.id, endpoint]
  );
  if (exists) {
    await query('UPDATE push_subscriptions SET p256dh = ?, auth = ? WHERE id = ?',
      [keys.p256dh, keys.auth, exists.id]);
  } else {
    await query(
      'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, NOW())',
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
  }
  ok(res, null, '推送订阅成功');
}));

/** 公开配置（前端读取：push 开关、VAPID 公钥、企业负责人阈值等） */
export const configRouter = Router();
configRouter.use(requireAuth);
configRouter.get('/public', asyncHandler(async (_req, res) => {
  const rows = await query('SELECT `key`, value FROM system_configs');
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  ok(res, {
    pushEnabled: pushConfigured(),
    vapidPublicKey: config.push.publicKey || null,
    companyHeadThresholdYuan: Number(map.company_head_threshold_cents || 10_000_000) / 100,
    receiptMaxCount: Number(map.receipt_max_count || 20),
    receiptMaxTotalMb: Number(map.receipt_max_total_mb || 100),
    remindTimeoutHours: Number(map.remind_timeout_hours || 48),
  });
}));
