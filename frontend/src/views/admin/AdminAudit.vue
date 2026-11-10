<template>
  <div>
    <!-- 说明 -->
    <div class="card">
      <div class="card-title">审计说明</div>
      <div class="desc-list">
        <div class="desc-item"><el-icon><Notebook /></el-icon><span>本页仅记录管理员在后台的管理操作（用户、部门、模板、配置、统计授权等），不可修改删除</span></div>
        <div class="desc-item"><el-icon><Notebook /></el-icon><span>审批流转日志（提交 / 通过 / 驳回 / 撤回）请在各申请详情页查看</span></div>
      </div>
    </div>

    <!-- 审计日志列表 -->
    <div class="card">
      <div class="card-title">操作日志</div>
      <div class="table-toolbar">
        <el-input
          v-model="keyword"
          placeholder="按操作 / 目标类型筛选（如 UPDATE_CONFIG、USER）"
          clearable
          class="kw-input"
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
        <el-button type="primary" :icon="Search" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading">
        <!-- 展开行：操作详情 JSON 美化显示 -->
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="detail-wrap">
              <div class="detail-title">操作详情（JSON）</div>
              <pre class="detail-json">{{ prettyDetail(row.detail) }}</pre>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作人" min-width="130">
          <template #default="{ row }">
            <div>{{ row.operator_name || '-' }}</div>
            <div class="text-muted">{{ row.operator_username }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="140">
          <template #default="{ row }">
            <el-tag size="small" :type="actionTagType(row.action)">{{ actionLabel(row.action) }}</el-tag>
            <div class="text-muted">{{ row.action }}</div>
          </template>
        </el-table-column>
        <el-table-column label="目标类型" width="110">
          <template #default="{ row }">{{ targetTypeLabel(row.target_type) }}</template>
        </el-table-column>
        <el-table-column prop="target_id" label="目标ID" width="90" align="center" />
        <el-table-column label="详情" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.detail || '-' }}</template>
        </el-table-column>
      </el-table>

      <div class="text-right mt8">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          :layout="paginationLayout"
          @current-change="load"
          @size-change="onSizeChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 审计日志：管理员后台操作留痕（后端按 keyword 匹配 action / target_type）。
 * detail 为 JSON 字符串，展开行 JSON.parse 后美化展示。
 */
import { ref, computed, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Search } from '@element-plus/icons-vue';
import { adminListAuditLogs } from '@/api';
import { formatDateTime } from '@/utils/format';
import { useNotifyStore } from '@/stores/notify';
import { useMobile } from '@/utils/useMobile';

const notify = useNotifyStore();
const isMobile = useMobile();

/* ---------- 操作 / 目标类型文案映射 ---------- */
const ACTION_LABELS = {
  GRANT_ROLE: '授予角色',
  CHANGE_DEPT: '调整部门',
  CONFIRM_DEPT: '确认部门归属',
  ENABLE_USER: '启用用户',
  DISABLE_USER: '停用用户',
  UPDATE_USER: '更新用户',
  CREATE_DEPT: '新建部门',
  UPDATE_DEPT: '修改部门',
  DELETE_DEPT: '删除部门',
  CREATE_TEMPLATE: '新建模板',
  PUBLISH_TEMPLATE: '发布模板',
  ENABLE_TEMPLATE: '启用模板',
  DISABLE_TEMPLATE: '停用模板',
  UPDATE_CONFIG: '修改配置',
  GRANT_STATS: '授予统计授权',
  REVOKE_STATS: '收回统计授权',
};
const ACTION_TAG_TYPES = {
  DELETE_DEPT: 'danger', DISABLE_USER: 'danger', DISABLE_TEMPLATE: 'danger', REVOKE_STATS: 'danger',
  GRANT_ROLE: 'success', GRANT_STATS: 'success', ENABLE_USER: 'success',
  ENABLE_TEMPLATE: 'success', CONFIRM_DEPT: 'success', PUBLISH_TEMPLATE: 'success',
  CREATE_DEPT: 'primary', CREATE_TEMPLATE: 'primary',
  CHANGE_DEPT: 'warning', UPDATE_DEPT: 'warning', UPDATE_CONFIG: 'warning', UPDATE_USER: 'warning',
};
const TARGET_TYPE_LABELS = {
  USER: '用户',
  DEPARTMENT: '部门',
  TEMPLATE: '流程模板',
  CONFIG: '系统配置',
  ROLE: '角色',
};

const actionLabel = (a) => ACTION_LABELS[a] || a;
const actionTagType = (a) => ACTION_TAG_TYPES[a] || 'info';
const targetTypeLabel = (t) => TARGET_TYPE_LABELS[t] || t;

// detail 为 JSON 字符串：解析后缩进美化；解析失败退回原文
function prettyDetail(detail) {
  if (!detail) return '-';
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

/* ---------- 列表 / 分页 ---------- */
const keyword = ref('');
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);

const paginationLayout = computed(() =>
  isMobile.value ? 'prev, pager, next' : 'total, prev, pager, next, jumper'
);

async function load() {
  loading.value = true;
  try {
    const data = await adminListAuditLogs({
      keyword: keyword.value.trim() || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    list.value = data.list;
    total.value = data.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
// 后台管理操作变化时自动刷新
watch(() => notify.refreshTick, load);

// 搜索条件变化时回到第一页
function onSearch() {
  page.value = 1;
  load();
}

function onReset() {
  keyword.value = '';
  onSearch();
}

function onSizeChange() {
  page.value = 1;
  load();
}
</script>

<style scoped>
.desc-list { display: flex; flex-direction: column; gap: 10px; }
.desc-item { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.desc-item .el-icon { color: var(--el-color-primary); }
.kw-input { width: 320px; max-width: 100%; }
.detail-wrap { padding: 4px 8px; }
.detail-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
.detail-json {
  margin: 0;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
}
</style>
