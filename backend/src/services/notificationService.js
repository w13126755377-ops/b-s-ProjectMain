/**
 * 站内通知服务：
 * - notifications 表持久化，UNIQUE(user_id, biz_key) + INSERT IGNORE 防重
 *   （同一次业务变化因请求重试不产生重复通知）
 * - 落库后立即 SSE 推送；Web Push（可选）后台触达
 */
import { pool } from '../db.js';
import { pushToUser } from '../utils/sse.js';
import { sendWebPush } from './pushService.js';

export const NOTIFY_TYPE = {
  TODO: 'TODO',          // 新待办
  APPROVED: 'APPROVED',  // 申请通过
  REJECTED: 'REJECTED',  // 申请驳回
  WITHDRAWN: 'WITHDRAWN',// 申请被撤回（通知当前审批人待办失效）
  REMIND: 'REMIND',      // 催办
  SYSTEM: 'SYSTEM',      // 系统消息
};

/**
 * 创建通知（幂等）。
 * @param {object} n { userId, type, title, content, link, bizKey }
 * @param conn 可选：事务连接（事务内插入）
 * @returns 是否真正新插入（false = 重复通知已忽略）
 */
export async function createNotification(n, conn = null) {
  const db = conn || pool;
  const [result] = await db.execute(
    `INSERT IGNORE INTO notifications (user_id, type, title, content, link, biz_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [n.userId, n.type, n.title, n.content, n.link || '', n.bizKey]
  );
  const inserted = result.affectedRows > 0;
  if (inserted && !conn) {
    // 非事务调用：立即推送
    emitNotification(n.userId, n);
  }
  return inserted;
}

/**
 * 事务提交后调用：SSE 推送 + Web Push（异步）。
 * 事务内只落库，避免事务未提交就推送造成"看到通知但查不到"的不一致。
 */
export async function emitNotification(userId, n) {
  const unread = await countUnread(userId);
  pushToUser(userId, 'notification', {
    id: n.id ?? 0, type: n.type, title: n.title, content: n.content,
    link: n.link || '', unread, createdAt: new Date().toISOString(),
  });
  sendWebPush(userId, n.title, n.content, n.link || '').catch(() => {});
}

/** 未读数（强制 user_id 过滤，非当前用户不可读） */
export async function countUnread(userId, conn = null) {
  const db = conn || pool;
  const [rows] = await db.execute(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return rows[0].c;
}

/** 业务变化后通知相关用户并触发前端刷新事件（提交事务后调用） */
export async function notifyStateChange(userIds, event, data) {
  for (const id of userIds) {
    pushToUser(id, event, data);
  }
}
