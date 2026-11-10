import { defineStore } from 'pinia';
import { ElNotification } from 'element-plus';
import { getStreamTicket, getUnreadCount } from '@/api';
import router from '@/router';

/**
 * 通知中心状态：
 * - SSE 实时流（60 秒短期 ticket 认证，EventSource 长连接）
 * - 连接失败自动降级为 30 秒轮询，并周期性重试 SSE
 * - 收到业务刷新事件（refresh）时递增 refreshTick，列表/详情页监听后自动刷新
 */
export const useNotifyStore = defineStore('notify', {
  state: () => ({
    unread: 0,
    connected: false,       // SSE 是否连通
    refreshTick: 0,         // 业务数据刷新信号（SSE refresh 事件 / 轮询检测到变化）
    _es: null,
    _pollTimer: null,
    _retryTimer: null,
    _lastPollUnread: null,
  }),
  actions: {
    async init() {
      this.stop();
      this._pollTimer = setInterval(() => this._poll(), 30000);
      this._retryTimer = setInterval(() => this._trySse(), 60000);
      await this._poll();
      this._trySse();
    },
    stop() {
      if (this._es) { this._es.close(); this._es = null; }
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
      if (this._retryTimer) { clearInterval(this._retryTimer); this._retryTimer = null; }
      this.connected = false;
    },
    async _poll() {
      if (!localStorage.getItem('token')) return; // 未登录/已退出不再轮询
      try {
        const { unread } = await getUnreadCount();
        if (this._lastPollUnread !== null && unread !== this._lastPollUnread) {
          this.refreshTick++;
        }
        this._lastPollUnread = unread;
        this.unread = unread;
      } catch { /* 忽略轮询失败 */ }
    },
    async _trySse() {
      if (this._es) return; // 已有连接
      if (!localStorage.getItem('token')) return; // 已退出不再建立 SSE
      try {
        const { ticket } = await getStreamTicket();
        const es = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(ticket)}`);
        this._es = es;
        es.addEventListener('hello', (e) => {
          try {
            const d = JSON.parse(e.data);
            this.connected = true;
            if (d.unread !== undefined) this.unread = d.unread;
          } catch { /* ignore */ }
        });
        es.addEventListener('notification', (e) => {
          try {
            const d = JSON.parse(e.data);
            if (d.unread !== undefined) this.unread = d.unread;
            this.refreshTick++;
            ElNotification({
              title: d.title || '新通知',
              message: d.content || '',
              type: d.type === 'REJECTED' ? 'warning' : d.type === 'REMIND' ? 'warning' : 'info',
              onClick: () => { if (d.link) router.push(d.link); },
            });
          } catch { /* ignore */ }
        });
        es.addEventListener('refresh', () => { this.refreshTick++; });
        es.onerror = () => {
          // ticket 只有 60 秒有效，自动重连无意义：关闭后由重试定时器用新 ticket 重建；
          // 等待重建期间由 30 秒轮询兜底
          this.connected = false;
          try { es.close(); } catch { /* ignore */ }
          if (this._es === es) this._es = null;
        };
      } catch { /* 降级轮询 */ }
    },
  },
});
