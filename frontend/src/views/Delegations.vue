<template>
  <div>
    <!-- 委托说明 -->
    <div class="card">
      <el-alert type="info" :closable="false" show-icon>
        <template #title>
          <div class="delegation-tip">
            委托在申请<strong>提交时解析生效</strong>：新提交的申请会按委托自动转交审批人。
            注意：角色类节点（部门负责人 / 财务 / 企业负责人）的受托人必须持有相应角色（部门负责人还须与委托人同部门），否则提交时将解析失败。
          </div>
        </template>
      </el-alert>
    </div>

    <!-- 委托列表 -->
    <div class="card" v-loading="loading">
      <div class="flex-between flex-wrap gap8 mb16">
        <h3 class="card-title" style="margin: 0">我的委托</h3>
        <el-button type="primary" @click="openCreate">
          <el-icon class="mr4"><Plus /></el-icon>新建委托
        </el-button>
      </div>

      <el-empty v-if="!loading && !list.length" description="暂无委托记录" :image-size="100" />
      <div v-else class="delegation-list">
        <div v-for="d in list" :key="d.id" class="delegation-item">
          <div class="delegation-main">
            <div class="delegation-info">
              <el-avatar :size="36" class="delegation-avatar">{{ (d.delegatee_name || '?')[0] }}</el-avatar>
              <div class="delegation-meta">
                <div class="delegation-name">
                  <span class="name-text">{{ d.delegatee_name }}</span>
                  <span class="text-muted">@{{ d.delegatee_username }}</span>
                  <el-tag :type="d.enabled ? 'success' : 'info'" size="small">{{ d.enabled ? '生效中' : '已停用' }}</el-tag>
                </div>
                <div class="text-muted delegation-time">
                  {{ formatDateTime(d.start_time) }} ~ {{ formatDateTime(d.end_time) }}
                </div>
              </div>
            </div>
            <div class="delegation-actions">
              <el-button
                size="small"
                :type="d.enabled ? 'warning' : 'success'"
                plain
                @click="toggleEnabled(d)"
              >
                {{ d.enabled ? '停用' : '启用' }}
              </el-button>
              <el-button size="small" type="danger" plain @click="removeDelegation(d)">删除</el-button>
            </div>
          </div>
          <div class="delegation-reason">
            <span class="text-muted">委托原因：</span>{{ d.reason }}
          </div>
        </div>
      </div>
    </div>

    <!-- 新建委托对话框 -->
    <el-dialog v-model="createVisible" title="新建委托" width="520px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="受托人" prop="delegateeId">
          <el-select
            v-model="form.delegateeId"
            filterable
            remote
            :remote-method="remoteSearch"
            :loading="userLoading"
            placeholder="输入姓名/用户名搜索"
            class="w-full"
          >
            <el-option
              v-for="u in userOptions"
              :key="u.id"
              :label="`${u.name}（${u.username}）`"
              :value="u.id"
            >
              <div class="user-option">
                <span>{{ u.name }}（{{ u.username }}）</span>
                <span class="text-muted">{{ u.dept_name || '未分配部门' }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="开始时间" prop="startTime">
          <el-date-picker
            v-model="form.startTime"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm"
            placeholder="选择开始时间"
            class="w-full"
            @change="onStartChange"
          />
        </el-form-item>
        <el-form-item label="结束时间" prop="endTime">
          <el-date-picker
            v-model="form.endTime"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm"
            placeholder="选择结束时间"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="委托原因" prop="reason">
          <el-input
            v-model="form.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="请填写委托原因（如：出差期间）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="create">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listDelegations, createDelegation, updateDelegation, deleteDelegation, searchUsers } from '@/api';
import { useNotifyStore } from '@/stores/notify';
import { formatDateTime } from '@/utils/format';

const notify = useNotifyStore();
const list = ref([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    list.value = await listDelegations();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

/* ---------- 新建委托 ---------- */
const createVisible = ref(false);
const creating = ref(false);
const formRef = ref();
const form = reactive({ delegateeId: null, startTime: '', endTime: '', reason: '' });

/** 校验结束时间晚于开始时间 */
function validateEnd(_r, v, cb) {
  if (v && form.startTime) {
    const end = new Date(v.replace(' ', 'T')).getTime();
    const start = new Date(form.startTime.replace(' ', 'T')).getTime();
    if (end <= start) return cb(new Error('结束时间必须晚于开始时间'));
  }
  cb();
}

const rules = {
  delegateeId: [{ required: true, message: '请选择受托人', trigger: 'change' }],
  startTime: [{ required: true, message: '请选择开始时间', trigger: 'change' }],
  endTime: [
    { required: true, message: '请选择结束时间', trigger: 'change' },
    { validator: validateEnd, trigger: 'change' },
  ],
  reason: [
    { required: true, message: '请填写委托原因', trigger: 'blur' },
    { max: 200, message: '委托原因不超过 200 字', trigger: 'blur' },
  ],
};

// 受托人远程搜索（excludeSelf=true，后端只返回启用用户）
const userOptions = ref([]);
const userLoading = ref(false);
async function remoteSearch(keyword) {
  const kw = (keyword || '').trim();
  if (!kw) { userOptions.value = []; return; }
  userLoading.value = true;
  try {
    userOptions.value = await searchUsers(kw, true);
  } catch {
    userOptions.value = [];
  } finally {
    userLoading.value = false;
  }
}

function openCreate() {
  form.delegateeId = null;
  form.startTime = '';
  form.endTime = '';
  form.reason = '';
  userOptions.value = [];
  createVisible.value = true;
}

// 开始时间变化后重新校验结束时间
function onStartChange() {
  if (form.endTime && formRef.value) formRef.value.validateField('endTime');
}

async function create() {
  try {
    await formRef.value.validate();
  } catch { return; }
  creating.value = true;
  try {
    await createDelegation({
      delegateeId: form.delegateeId,
      startTime: form.startTime,
      endTime: form.endTime,
      reason: form.reason.trim(),
    });
    ElMessage.success('委托已创建');
    createVisible.value = false;
    load();
  } catch (e) {
    // 409 时间重叠等后端提示原样展示
    ElMessage.error(e.message);
  } finally {
    creating.value = false;
  }
}

/* ---------- 启用 / 停用 ---------- */
async function toggleEnabled(d) {
  try {
    await updateDelegation(d.id, { enabled: !d.enabled });
    ElMessage.success(d.enabled ? '委托已停用' : '委托已启用');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

/* ---------- 删除 ---------- */
async function removeDelegation(d) {
  try {
    await ElMessageBox.confirm(
      `确定删除对「${d.delegatee_name}」的委托吗？删除后不可恢复。`,
      '删除委托',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    );
  } catch { return; }
  try {
    await deleteDelegation(d.id);
    ElMessage.success('委托已删除');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(load);
// 业务刷新信号（如角色/部门被管理员调整）时重载
watch(() => notify.refreshTick, load);
</script>

<style scoped>
.mr4 { margin-right: 4px; }
.delegation-tip { font-size: 13px; line-height: 1.7; }
.delegation-list { display: flex; flex-direction: column; gap: 12px; }

.delegation-item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  transition: box-shadow 0.15s;
}
.delegation-item:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06); }

.delegation-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.delegation-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
.delegation-avatar { background: var(--el-color-primary-light-3); color: #fff; flex-shrink: 0; }
.delegation-meta { min-width: 0; }
.delegation-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.name-text { font-weight: 600; }
.delegation-time { margin-top: 2px; }
.delegation-actions { display: flex; gap: 8px; flex-shrink: 0; }
.delegation-reason {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--el-border-color-lighter);
  font-size: 13px;
  color: var(--el-text-color-regular);
  word-break: break-all;
}

.user-option { display: flex; justify-content: space-between; gap: 12px; }

@media (max-width: 768px) {
  .delegation-main { flex-direction: column; }
  .delegation-actions { width: 100%; }
  .delegation-actions .el-button { flex: 1; margin-left: 0; }
}
</style>
