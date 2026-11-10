/**
 * SSE（Server-Sent Events）Hub：
 * 按 user_id 维护连接集合，通知落库后向对应用户推送。
 * 同时推送 'refresh' 事件，前端据此自动刷新待办/申请/统计列表
 * （满足"手机页面打开时自动显示待办或结果变化，无需手动刷新"）。
 */

/** @type {Map<number, Set<import('express').Response>>} */
const clients = new Map();

export function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  res.on('close', () => removeClient(userId, res));
}

export function removeClient(userId, res) {
  const set = clients.get(userId);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(userId);
  }
}

/** 向单个用户推送事件 */
export function pushToUser(userId, event, data) {
  const set = clients.get(Number(userId));
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* 连接已断，close 事件会清理 */ }
  }
}

/** 向多个用户推送同一事件 */
export function pushToUsers(userIds, event, data) {
  for (const id of userIds) pushToUser(id, event, data);
}
