<template>
  <div>
    <!-- 授权说明 -->
    <div class="card">
      <div class="card-title">统计授权说明</div>
      <div class="desc-list">
        <div class="desc-item">
          <el-tag size="small" type="warning">FINANCE</el-tag>
          <span>财务统计口径：报销 + 采购申请，覆盖全部部门</span>
        </div>
        <div class="desc-item">
          <el-tag size="small" type="primary">COMPANY</el-tag>
          <span>企业范围统计：全部部门、全部申请类型</span>
        </div>
        <div class="desc-item">
          <el-tag size="small" type="success">DEPT_HEAD</el-tag>
          <span>部门负责人角色自带本部门统计，无需授权</span>
        </div>
        <div class="desc-item">
          <el-tag size="small" type="danger">ADMIN</el-tag>
          <span>系统管理员默认可查看全部统计数据</span>
        </div>
        <div class="desc-item">
          <el-icon><Lock /></el-icon>
          <span>仅管理员可授予 / 收回，操作均写入审计日志</span>
        </div>
      </div>
    </div>

    <!-- 授权列表 -->
    <div class="card">
      <div class="flex-between flex-wrap gap8" style="margin-bottom: 12px;">
        <div class="card-title" style="margin: 0;">授权列表</div>
        <el-button type="primary" :icon="Plus" @click="openGrant">授予统计</el-button>
      </div>
      <el-table :data="list" v-loading="loading">
        <el-table-column prop="user_name" label="姓名" min-width="110" />
        <el-table-column prop="username" label="账号" min-width="110" />
        <el-table-column label="授权范围" width="120" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.scope === 'FINANCE' ? 'warning' : 'primary'">{{ row.scope }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="granted_by_name" label="授予人" min-width="100" />
        <el-table-column label="授予时间" width="150">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" @click="onRevoke(row)">收回</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 授予对话框：用户远程搜索 + 范围单选 -->
    <el-dialog v-model="dialogVisible" title="授予统计权限" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" :label-position="isMobile ? 'top' : 'right'" label-width="80px">
        <el-form-item label="用户" prop="userId">
          <el-select
            v-model="form.userId"
            filterable
            remote
            :remote-method="searchUser"
            :loading="userLoading"
            placeholder="输入姓名 / 账号搜索用户"
            class="w-full"
          >
            <el-option v-for="u in userOptions" :key="u.id" :value="u.id" :label="`${u.name}（${u.username}）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="统计范围" prop="scope">
          <el-radio-group v-model="form.scope">
            <el-radio value="FINANCE">FINANCE · 报销+采购全部门</el-radio>
            <el-radio value="COMPANY">COMPANY · 全部部门全部类型</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSubmit">授予</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
/**
 * 统计授权：管理员按「明确授权」机制授予 / 收回统计范围。
 * FINANCE = 报销+采购全部门；COMPANY = 全部部门全部类型（企业范围）。
 * 部门负责人角色自带本部门统计，管理员自带全部数据，无需在此授权。
 */
import { ref, reactive, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import {
  adminListStatsGrants, adminCreateStatsGrant, adminDeleteStatsGrant, adminListUsers,
} from '@/api';
import { formatDateTime } from '@/utils/format';
import { useNotifyStore } from '@/stores/notify';
import { useMobile } from '@/utils/useMobile';

const notify = useNotifyStore();
const isMobile = useMobile();

const list = ref([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    list.value = await adminListStatsGrants();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
// 授权变化（含其他管理员操作）时自动刷新
watch(() => notify.refreshTick, load);

/* ---------- 授予对话框 ---------- */
const dialogVisible = ref(false);
const saving = ref(false);
const formRef = ref();
const form = reactive({ userId: null, scope: 'FINANCE' });
const rules = {
  userId: [{ required: true, message: '请选择用户', trigger: 'change' }],
  scope: [{ required: true, message: '请选择统计范围', trigger: 'change' }],
};

const userOptions = ref([]);
const userLoading = ref(false);

// 远程搜索用户（一次最多 50 条候选）
async function searchUser(keyword) {
  userLoading.value = true;
  try {
    const data = await adminListUsers({ keyword: keyword || undefined, pageSize: 50 });
    userOptions.value = data.list;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    userLoading.value = false;
  }
}

function openGrant() {
  form.userId = null;
  form.scope = 'FINANCE';
  searchUser('');
  dialogVisible.value = true;
}

async function onSubmit() {
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    await adminCreateStatsGrant({ userId: form.userId, scope: form.scope });
    ElMessage.success('统计授权已授予');
    dialogVisible.value = false;
    await load();
  } catch (e) {
    // 409「该授权已存在」等冲突提示直接展示后端文案
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

/* ---------- 收回 ---------- */
async function onRevoke(row) {
  try {
    await ElMessageBox.confirm(
      `确定收回「${row.user_name}」的 ${row.scope} 统计授权吗？`,
      '收回确认',
      { type: 'warning', confirmButtonText: '收回', cancelButtonText: '取消' }
    );
  } catch { return; }
  try {
    await adminDeleteStatsGrant(row.id);
    ElMessage.success('授权已收回');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}
</script>

<style scoped>
.desc-list { display: flex; flex-direction: column; gap: 10px; }
.desc-item { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.desc-item .el-icon { color: var(--el-color-primary); }
</style>
