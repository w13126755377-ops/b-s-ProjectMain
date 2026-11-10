/**
 * Web Push（可选增强功能）：
 * 页面关闭/后台时通过浏览器 Push API 触达。
 * 未配置 VAPID 或用户未授权时自动禁用；发送失败静默降级（站内通知仍可查询）。
 */
import { pool } from '../db.js';
import { config } from '../config.js';

let webpush = null;
let vapidReady = false;

try {
  if (config.push.enabled && config.push.publicKey && config.push.privateKey) {
    const mod = await import('web-push');
    webpush = mod.default;
    webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
    vapidReady = true;
  }
} catch {
  vapidReady = false;
}

export function pushConfigured() {
  return vapidReady;
}

/** 给用户的所有订阅发送推送；无效订阅（410/404）自动清理 */
export async function sendWebPush(userId, title, body, link) {
  if (!vapidReady) return;
  const subs = await pool.execute(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    [userId]
  );
  for (const sub of subs[0]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body, link: link || '/', ts: new Date().toISOString() })
      );
    } catch (err) {
      if (err && (err.statusCode === 410 || err.statusCode === 404)) {
        await pool.execute('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
      }
      // 其他失败静默：不阻塞业务
    }
  }
}
