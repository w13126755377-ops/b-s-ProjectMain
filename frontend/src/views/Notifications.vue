<template>
  <div class="card">
    <!-- 顶栏：未读筛选 + 全部已读 -->
    <div class="flex-between flex-wrap gap8 mb16">
      <el-radio-group v-model="filter" @change="onFilterChange">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="unread">未读</el-radio-button>
      </el-radio-group>
      <el-button type="primary" plain :disabled="!notify.unread" :loading="readingAll" @click="onReadAll">
        <el-icon class="mr4"><Finished /></el-icon>全部标为已读
      </el-button>
    </div>

    <!-- 通知列表 -->
    <div v-loading="loading" class="notify-wrap">
      <el-empty v-if="!loading && !list.length" description="暂无通知" :image-size="100" />
      <div v-else class="notify-list">
        <div
          v-for="n in list"
          :key="n.id"
          class="notify-item"
          :class="{ 'is-unread': !n.is_read }"
          @click="onClick(n)"
        >
          <el-icon class="notify-icon" :style="{ color: NOTIFY_TYPE_COLOR[n.type] || NOTIFY_TYPE_COLOR.SYSTEM }">
            <component :is="NOTIFY_TYPE_ICON[n.type] || 'Bell'" />
          </el-icon>
          <div class="notify-body">
            <div class="notify-title">
              <span class="notify-title-text">{{ n.title }}</span>
              <span class="notify-time text-muted">{{ formatDateTime(n.created_at) }}</span>
            </div>
            <div class="notify-content">{{ n.content }}</div>
          </div>
          <!-- 未读圆点 -->
          <span v-if="!n.is_read" class="unread-dot" />
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div class="flex mt16" style="justify-content: flex-end">
      <el-pagination
        v-if="total > 0"
        v-model:current-page="page"
        background
        :page-size="pageSize"
        :total="total"
        :layout="isMobile ? 'prev, pager, next' : 'total, prev, pager, next, jumper'"
        @current-change="load"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listNotifications, readNotification, readAllNotifications } from '@/api';
import { useNotifyStore } from '@/stores/notify';
import { useMobile } from '@/utils/useMobile';
import { formatDateTime, NOTIFY_TYPE_ICON } from '@/utils/format';

const router = useRouter();
const notify = useNotifyStore();
const isMobile = useMobile();

/** 不同通知类型使用不同图标颜色 */
const NOTIFY_TYPE_COLOR = {
  TODO: 'var(--el-color-primary)',      // 新待办：主题蓝
  APPROVED: 'var(--el-color-success)',  // 通过：绿
  REJECTED: 'var(--el-color-danger)',   // 驳回：红
  WITHDRAWN: 'var(--el-color-warning)', // 撤回：橙
  REMIND: 'var(--el-color-warning)',    // 催办：橙
  SYSTEM: 'var(--el-color-info)',       // 系统：灰
};

const filter = ref('all'); // all | unread
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const readingAll = ref(false);

async function load() {
  loading.value = true;
  try {
    const data = await listNotifications({
      unread: filter.value === 'unread' ? '1' : undefined,
      page: page.value,
      pageSize,
    });
    list.value = data.list;
    total.value = data.total;
    // 列表接口携带最新未读数，同步顶栏红点
    if (typeof data.unread === 'number') notify.unread = data.unread;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function onFilterChange() {
  page.value = 1;
  load();
}

/** 点击通知：未读则标记已读（本地乐观减一），link 非空则跳转 */
async function onClick(n) {
  if (!n.is_read) {
    n.is_read = 1; // 圆点立即消失
    if (notify.unread > 0) notify.unread--;
    readNotification(n.id)
      .then((d) => {
        // 以后端返回的未读数为准校正
        if (d && typeof d.unread === 'number') notify.unread = d.unread;
      })
      .catch(() => { /* 标记失败由轮询未读数兜底，不阻断跳转 */ });
  }
  if (n.link) router.push(n.link);
}

async function onReadAll() {
  try {
    await ElMessageBox.confirm('确定将所有通知标记为已读吗？', '提示', { type: 'info' });
  } catch { return; }
  readingAll.value = true;
  try {
    await readAllNotifications();
    notify.unread = 0;
    ElMessage.success('已全部标记为已读');
    load(); // 未读筛选下重新加载，已读项从列表消失
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    readingAll.value = false;
  }
}

onMounted(load);
// SSE 业务刷新信号：实时重载通知列表
watch(() => notify.refreshTick, load);
</script>

<style scoped>
.mr4 { margin-right: 4px; }
.notify-wrap { min-height: 120px; }
.notify-list { display: flex; flex-direction: column; }

.notify-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.notify-item:hover { background: var(--el-fill-color-light); }
.notify-item.is-unread { background: var(--el-color-primary-light-9); }
.notify-item.is-unread:hover { background: var(--el-color-primary-light-8); }

.notify-icon { font-size: 22px; margin-top: 2px; flex-shrink: 0; }
.notify-body { flex: 1; min-width: 0; }

.notify-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.notify-title-text { font-weight: 600; font-size: 14px; }
.notify-time { flex-shrink: 0; }
.notify-content {
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  word-break: break-all;
}

/* 未读红色圆点 */
.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-danger);
  flex-shrink: 0;
  margin-top: 8px;
}

@media (max-width: 768px) {
  .notify-title { flex-direction: column; gap: 2px; }
  .notify-item { padding: 12px 4px; }
}
</style>
