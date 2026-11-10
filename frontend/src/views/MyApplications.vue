<template>
  <div>
    <div class="card">
      <!-- 顶部标题 + 发起申请入口 -->
      <div class="flex-between mb16">
        <h3 class="card-title" style="margin: 0">我的申请</h3>
        <el-button type="primary" @click="goCreate">
          <el-icon style="margin-right: 4px"><Plus /></el-icon>发起申请
        </el-button>
      </div>

      <!-- 筛选工具栏：关键词（标题/单号）+ 类型 + 状态 + 日期范围 -->
      <div class="table-toolbar">
        <el-input
          v-model="filters.keyword"
          class="toolbar-keyword"
          placeholder="搜索标题 / 单号"
          clearable
          @keyup.enter="search"
          @clear="search"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="filters.type" class="toolbar-select" placeholder="全部类型" clearable>
          <el-option v-for="(label, value) in TYPE_LABEL" :key="value" :label="label" :value="value" />
        </el-select>
        <el-select v-model="filters.status" class="toolbar-select" placeholder="全部状态" clearable>
          <el-option v-for="(label, value) in STATUS_LABEL" :key="value" :label="label" :value="value" />
        </el-select>
        <el-date-picker
          v-model="filters.dateRange"
          class="toolbar-date"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        />
        <el-button type="primary" @click="search">
          <el-icon style="margin-right: 4px"><Search /></el-icon>查询
        </el-button>
        <el-button @click="reset">
          <el-icon style="margin-right: 4px"><Refresh /></el-icon>重置
        </el-button>
      </div>

      <!-- 申请列表：点击行进入详情（移动端便于操作） -->
      <el-table
        v-if="total > 0"
        v-loading="loading"
        :data="list"
        row-key="id"
        :row-style="{ cursor: 'pointer' }"
        @row-click="(row) => goDetail(row.id)"
      >
        <el-table-column v-if="!isMobile" prop="app_no" label="申请单号" width="150">
          <template #default="{ row }"><span class="text-muted">{{ row.app_no }}</span></template>
        </el-table-column>
        <el-table-column label="标题" min-width="220">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click.stop="goDetail(row.id)">{{ row.title }}</el-link>
            <!-- 移动端不渲染"当前审批人"列，改在标题下方展示 -->
            <div v-if="isMobile && row.status === 'IN_APPROVAL' && row.current_approver_name" class="mt8 text-muted">
              当前审批人：{{ row.current_approver_name }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">{{ TYPE_LABEL[row.type] || row.type }}</template>
        </el-table-column>
        <el-table-column label="金额" width="130" align="right">
          <template #default="{ row }"><MoneyText :cents="row.total_amount_cents" strong /></template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="当前审批人" width="110">
          <template #default="{ row }">
            {{ row.status === 'IN_APPROVAL' ? row.current_approver_name || '-' : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }">{{ formatDateTime(row.submitted_at) }}</template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="创建时间" width="150">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
        <!-- 操作列：按状态机显隐（DRAFT 编辑/提交/删除；审批中撤回；驳回/撤回复制重提） -->
        <el-table-column label="操作" width="230">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button link type="primary" size="small" @click.stop="goDetail(row.id)">查看</el-button>
              <template v-if="row.status === 'DRAFT'">
                <el-button link type="primary" size="small" :loading="actingId === row.id" @click.stop="goEdit(row.id)">
                  编辑
                </el-button>
                <el-button link type="success" size="small" :loading="actingId === row.id" @click.stop="handleSubmit(row)">
                  提交
                </el-button>
                <el-button link type="danger" size="small" :loading="actingId === row.id" @click.stop="handleDelete(row)">
                  删除
                </el-button>
              </template>
              <el-button
                v-else-if="row.status === 'IN_APPROVAL'"
                link
                type="warning"
                size="small"
                :loading="actingId === row.id"
                @click.stop="handleWithdraw(row)"
              >
                撤回
              </el-button>
              <el-button
                v-else-if="row.status === 'REJECTED' || row.status === 'WITHDRAWN'"
                link
                type="primary"
                size="small"
                :loading="actingId === row.id"
                @click.stop="handleCopy(row)"
              >
                复制重提
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 首次加载骨架屏 -->
      <el-skeleton v-else-if="loading" :rows="6" animated />

      <!-- 空状态 -->
      <el-empty v-else description="暂无申请，去发起一个吧">
        <el-button type="primary" @click="goCreate">发起申请</el-button>
      </el-empty>

      <!-- 分页：桌面完整布局 / 移动端精简布局 -->
      <div v-if="total > 0" class="pagination-row">
        <el-pagination
          background
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          :layout="paginationLayout"
          @current-change="onPageChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  listApplications,
  submitApplication,
  withdrawApplication,
  copyApplication,
  deleteApplication,
} from '@/api';
import { TYPE_LABEL, STATUS_LABEL, formatDateTime } from '@/utils/format';
import { useNotifyStore } from '@/stores/notify';
import { useMobile } from '@/utils/useMobile';
import MoneyText from '@/components/MoneyText.vue';
import StatusTag from '@/components/StatusTag.vue';

const router = useRouter();
const notify = useNotifyStore();
const isMobile = useMobile();

/* ---------- 筛选与分页状态 ---------- */
const filters = reactive({ keyword: '', type: '', status: '', dateRange: null });
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const actingId = ref(null); // 正在执行操作的行 id（按钮 loading，防重复点击）

// 桌面完整分页布局，移动端只保留 prev/pager/next
const paginationLayout = computed(() =>
  isMobile.value ? 'prev, pager, next' : 'total, prev, pager, next, jumper'
);

/* ---------- 数据加载 ---------- */
async function load() {
  loading.value = true;
  try {
    const data = await listApplications({
      page: page.value,
      pageSize,
      keyword: filters.keyword.trim() || undefined,
      type: filters.type || undefined,
      status: filters.status || undefined,
      dateFrom: filters.dateRange?.[0] || undefined,
      dateTo: filters.dateRange?.[1] || undefined,
    });
    list.value = data.list;
    total.value = data.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function reset() {
  filters.keyword = '';
  filters.type = '';
  filters.status = '';
  filters.dateRange = null;
  search();
}

function onPageChange(p) {
  page.value = p;
  load();
}

// 通知 SSE / 轮询检测到业务变化时自动刷新列表（作业要求）
watch(
  () => notify.refreshTick,
  () => {
    load();
  }
);

onMounted(load);

/* ---------- 路由跳转 ---------- */
function goDetail(id) {
  router.push(`/apps/${id}`);
}
function goEdit(id) {
  router.push(`/apps/${id}/edit`);
}
function goCreate() {
  router.push('/apps/new');
}

/* ---------- 行操作 ---------- */
/** 跨单重复票据预警弹窗（警告不阻断，仅提示） */
function showWarnings(warnings) {
  const lines = (warnings || []).map(
    (w) => `「${w.title || w.appNo || '他单'}」存在重复票据：${w.receiptNo || w.fileName || '未知票据'}`
  );
  ElMessageBox.alert(lines.join('<br/>'), '重复票据预警', {
    type: 'warning',
    dangerouslyUseHTMLString: true,
    confirmButtonText: '知道了',
  }).catch(() => {});
}

/** 提交草稿：确认后调用接口，返回重复票据预警则弹窗提示 */
async function handleSubmit(row) {
  try {
    await ElMessageBox.confirm(`确认提交「${row.title}」？提交后将进入审批流程，不可再编辑。`, '提交确认', {
      type: 'warning',
      confirmButtonText: '确认提交',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  actingId.value = row.id;
  try {
    const res = await submitApplication(row.id);
    if (res && res.warnings && res.warnings.length) showWarnings(res.warnings);
    ElMessage.success('提交成功');
    load();
  } catch (e) {
    ElMessage.error(e.message);
    load(); // 409 状态冲突：提示后刷新兜底
  } finally {
    actingId.value = null;
  }
}

/** 撤回审批中的申请 */
async function handleWithdraw(row) {
  try {
    await ElMessageBox.confirm(`确认撤回「${row.title}」？撤回后可在列表中“复制重提”。`, '撤回确认', {
      type: 'warning',
      confirmButtonText: '确认撤回',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  actingId.value = row.id;
  try {
    await withdrawApplication(row.id);
    ElMessage.success('已撤回');
    load();
  } catch (e) {
    ElMessage.error(e.message);
    load(); // 并发冲突 409：提示后刷新
  } finally {
    actingId.value = null;
  }
}

/** 删除草稿（危险操作需二次确认） */
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除草稿「${row.title}」？删除后不可恢复。`, '删除确认', {
      type: 'error',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  actingId.value = row.id;
  try {
    await deleteApplication(row.id);
    ElMessage.success('草稿已删除');
    if (list.value.length === 1 && page.value > 1) page.value -= 1; // 当前页删空则回退一页
    load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    actingId.value = null;
  }
}

/** 复制重提：成功后跳转新草稿编辑页 */
async function handleCopy(row) {
  actingId.value = row.id;
  try {
    const res = await copyApplication(row.id);
    ElMessage.success('已复制为新草稿，请修改后重新提交');
    router.push(`/apps/${res.id}/edit`);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    actingId.value = null;
  }
}
</script>

<style scoped>
.toolbar-keyword { width: 200px; }
.toolbar-select { width: 140px; }
.toolbar-date { width: 260px; }

/* 操作按钮允许换行；抵消 Element Plus 相邻按钮默认左间距 */
.row-actions { display: flex; flex-wrap: wrap; align-items: center; }
.row-actions .el-button + .el-button { margin-left: 0; }

.pagination-row { display: flex; justify-content: flex-end; margin-top: 12px; }

/* 移动端：筛选控件全宽、分页居中，保证核心操作可用 */
@media (max-width: 768px) {
  .toolbar-keyword, .toolbar-select, .toolbar-date { width: 100%; }
  .pagination-row { justify-content: center; }
}
</style>
