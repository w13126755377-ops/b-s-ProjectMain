<template>
  <div class="card">
    <h3 class="card-title">审批任务</h3>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <!-- ============ 待办 ============ -->
      <el-tab-pane name="todo">
        <template #label>
          <el-badge :value="todoList.length" :hidden="!todoList.length" :max="99">
            <span class="tab-label">待办</span>
          </el-badge>
        </template>

        <div v-loading="todoLoading">
          <!-- 桌面端：表格 -->
          <el-table v-if="!isMobile" :data="todoList" stripe>
            <el-table-column prop="app_no" label="申请编号" min-width="140" />
            <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">{{ TYPE_LABEL[row.type] || row.type }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }"><StatusTag :status="row.status" /></template>
            </el-table-column>
            <el-table-column label="金额" width="130" align="right">
              <template #default="{ row }"><MoneyText :cents="row.total_amount_cents" strong /></template>
            </el-table-column>
            <el-table-column prop="applicant_name" label="申请人" width="100" />
            <el-table-column label="提交时间" width="150">
              <template #default="{ row }">{{ formatDateTime(row.submitted_at) }}</template>
            </el-table-column>
            <el-table-column label="当前节点" min-width="130">
              <template #default="{ row }">
                <span>{{ row.current_node?.name || '-' }}</span>
                <el-tooltip
                  v-if="row.is_delegated"
                  content="受托代办：由原审批人委托"
                  placement="top"
                >
                  <el-tag size="small" type="warning" class="delegate-tag">代</el-tag>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="goDetail(row)">查看详情</el-button>
                <el-button link type="success" size="small" @click="openApprove(row)">批准</el-button>
                <el-button link type="danger" size="small" @click="openReject(row)">驳回</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty description="暂无待办" :image-size="80" />
            </template>
          </el-table>

          <!-- 移动端：卡片列表（核心操作可用） -->
          <template v-else>
            <el-empty v-if="!todoList.length" description="暂无待办" :image-size="80" />
            <div v-else class="todo-cards">
              <div v-for="t in todoList" :key="t.instance_id" class="todo-card">
                <div class="flex-between">
                  <span class="app-no">{{ t.app_no }}</span>
                  <StatusTag :status="t.status" />
                </div>
                <div class="todo-title">{{ t.title }}</div>
                <div class="todo-meta">
                  <span>{{ TYPE_LABEL[t.type] || t.type }}</span>
                  <MoneyText :cents="t.total_amount_cents" strong />
                </div>
                <div class="todo-meta text-muted">
                  <span>申请人：{{ t.applicant_name }}</span>
                  <span>{{ formatDateTime(t.submitted_at) }}</span>
                </div>
                <div class="todo-node">
                  <span>当前节点：{{ t.current_node?.name || '-' }}</span>
                  <el-tooltip
                    v-if="t.is_delegated"
                    content="受托代办：由原审批人委托"
                    placement="top"
                  >
                    <el-tag size="small" type="warning">代</el-tag>
                  </el-tooltip>
                </div>
                <div class="todo-actions">
                  <el-button size="small" @click="goDetail(t)">查看详情</el-button>
                  <el-button size="small" type="success" @click="openApprove(t)">批准</el-button>
                  <el-button size="small" type="danger" @click="openReject(t)">驳回</el-button>
                </div>
              </div>
            </div>
          </template>
        </div>
      </el-tab-pane>

      <!-- ============ 已办 ============ -->
      <el-tab-pane label="已办" name="done">
        <div v-loading="doneLoading">
          <el-table :data="doneList" stripe>
            <el-table-column prop="app_no" label="申请编号" min-width="140" />
            <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">{{ TYPE_LABEL[row.type] || row.type }}</template>
            </el-table-column>
            <el-table-column label="金额" width="130" align="right">
              <template #default="{ row }"><MoneyText :cents="row.total_amount_cents" strong /></template>
            </el-table-column>
            <el-table-column prop="applicant_name" label="申请人" width="100" />
            <el-table-column label="我的操作" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.my_action === 'APPROVE'" type="success" size="small">通过</el-tag>
                <el-tag v-else-if="row.my_action === 'REJECT'" type="danger" size="small">驳回</el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="我的意见" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.my_comment || '-' }}</template>
            </el-table-column>
            <el-table-column label="处理时间" width="150">
              <template #default="{ row }">{{ formatDateTime(row.finished_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="goDetail(row)">查看详情</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty description="暂无已办事项" :image-size="80" />
            </template>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 批准 / 驳回 对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'approve' ? '批准申请' : '驳回申请'"
      width="480px"
      :close-on-click-modal="false"
      append-to-body
    >
      <div class="dialog-info">
        {{ currentTask?.app_no }}　{{ currentTask?.title }}
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="88px" @submit.prevent>
        <el-form-item v-if="dialogMode === 'approve'" label="审批意见" prop="comment">
          <el-input
            v-model="form.comment"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="选填，可填写审批意见"
          />
        </el-form-item>
        <el-form-item v-else label="驳回理由" prop="reason">
          <el-input
            v-model="form.reason"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="必填，请说明驳回理由"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button
          :type="dialogMode === 'approve' ? 'success' : 'danger'"
          :loading="submitting"
          @click="submitAction"
        >
          {{ dialogMode === 'approve' ? '确定批准' : '确定驳回' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listTasks, approveTask, rejectTask } from '@/api';
import { useNotifyStore } from '@/stores/notify';
import { useMobile } from '@/utils/useMobile';
import { TYPE_LABEL, formatDateTime } from '@/utils/format';
import MoneyText from '@/components/MoneyText.vue';
import StatusTag from '@/components/StatusTag.vue';

const router = useRouter();
const notify = useNotifyStore();
const isMobile = useMobile();

const activeTab = ref('todo');
const todoList = ref([]);
const doneList = ref([]);
const todoLoading = ref(false);
const doneLoading = ref(false);

/* ---------- 批准 / 驳回 对话框 ---------- */
const dialogVisible = ref(false);
const dialogMode = ref('approve'); // approve=批准 / reject=驳回
const currentTask = ref(null);
const submitting = ref(false);
const formRef = ref();
const form = ref({ comment: '', reason: '' });
const rules = {
  // 驳回理由：必填且至少 1 个字符
  reason: [
    { required: true, message: '请填写驳回理由', trigger: 'blur' },
    { min: 1, max: 500, message: '驳回理由长度须为 1~500 个字符', trigger: 'blur' },
  ],
};

/* ---------- 列表加载 ---------- */
async function loadTodo() {
  todoLoading.value = true;
  try {
    todoList.value = await listTasks('todo');
  } catch (e) {
    ElMessage.error(e.message || '加载待办失败');
  } finally {
    todoLoading.value = false;
  }
}

async function loadDone() {
  doneLoading.value = true;
  try {
    doneList.value = await listTasks('done');
  } catch (e) {
    ElMessage.error(e.message || '加载已办失败');
  } finally {
    doneLoading.value = false;
  }
}

/** 重新加载当前激活 tab 的数据 */
function loadCurrent() {
  return activeTab.value === 'todo' ? loadTodo() : loadDone();
}

/** tab 切换时重新加载 */
function onTabChange() {
  loadCurrent();
}

function goDetail(row) {
  router.push(`/apps/${row.application_id}`);
}

/* ---------- 审批操作 ---------- */
function openApprove(row) {
  currentTask.value = row;
  dialogMode.value = 'approve';
  form.value = { comment: '', reason: '' };
  dialogVisible.value = true;
}

function openReject(row) {
  currentTask.value = row;
  dialogMode.value = 'reject';
  form.value = { comment: '', reason: '' };
  dialogVisible.value = true;
}

async function submitAction() {
  const isApprove = dialogMode.value === 'approve';
  if (!isApprove) {
    // 驳回理由：必填、去空白后至少 1 个字符
    const ok = await formRef.value.validate().catch(() => false);
    if (!ok) return;
    if (!form.value.reason.trim()) {
      ElMessage.warning('请填写驳回理由');
      return;
    }
  }
  const { instance_id, application_id } = currentTask.value;
  submitting.value = true;
  try {
    // 审批接口使用 instance_id（待办任务标识）
    if (isApprove) {
      await approveTask(instance_id, form.value.comment.trim());
    } else {
      await rejectTask(instance_id, form.value.reason.trim());
    }
    dialogVisible.value = false;
    await loadCurrent(); // 成功后刷新列表
    // 提示可跳转查看申请详情
    ElMessageBox.confirm('审批处理成功，是否前往查看申请详情？', '处理成功', {
      confirmButtonText: '查看详情',
      cancelButtonText: '留在本页',
      type: 'success',
    })
      .then(() => router.push(`/apps/${application_id}`))
      .catch(() => {});
  } catch (e) {
    if (e.code === 409) {
      // 并发冲突：待办可能已被他人处理或申请状态已变化
      ElMessage.error('该申请状态已变化（可能已被他人处理）');
      loadCurrent();
    } else {
      ElMessage.error(e.message || '操作失败');
    }
  } finally {
    submitting.value = false;
  }
}

// SSE 业务刷新信号（notify.refreshTick 变化）→ 自动重载当前列表
watch(
  () => notify.refreshTick,
  () => {
    loadCurrent();
  }
);

onMounted(loadTodo);
</script>

<style scoped>
/* 待办 tab 标签与徽标间距 */
.tab-label {
  padding: 0 4px;
}
.delegate-tag {
  margin-left: 6px;
}
/* 移动端待办卡片列表 */
.todo-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.todo-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.app-no {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.todo-title {
  font-size: 15px;
  font-weight: 600;
  word-break: break-all;
}
.todo-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}
.todo-node {
  font-size: 13px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.todo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}
/* 对话框内申请信息 */
.dialog-info {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
  word-break: break-all;
}
</style>
