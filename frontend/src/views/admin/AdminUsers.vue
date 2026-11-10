<template>
  <div class="card">
    <div class="card-title">用户管理</div>

    <!-- 筛选栏：关键词（用户名/姓名/邮箱）、部门、角色 -->
    <div class="table-toolbar">
      <el-row :gutter="8" class="w-full">
        <el-col :xs="24" :sm="12" :md="6">
          <el-input
            v-model="filters.keyword"
            placeholder="用户名 / 姓名 / 邮箱"
            clearable
            class="w-full"
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
        </el-col>
        <el-col :xs="12" :sm="6" :md="4">
          <el-select v-model="filters.deptId" placeholder="部门" clearable class="w-full" @change="handleSearch">
            <el-option v-for="d in deptOptions" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-col>
        <el-col :xs="12" :sm="6" :md="4">
          <el-select v-model="filters.roleId" placeholder="角色" clearable class="w-full" @change="handleSearch">
            <el-option v-for="r in roleOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-col>
        <el-col :xs="24" :sm="12" :md="10">
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </el-col>
      </el-row>
    </div>

    <!-- 用户表格 -->
    <el-table v-loading="loading" :data="list" stripe>
      <el-table-column prop="username" label="用户名" min-width="110" show-overflow-tooltip />
      <el-table-column label="姓名" min-width="90" show-overflow-tooltip>
        <template #default="{ row }">{{ row.name || '-' }}</template>
      </el-table-column>
      <el-table-column prop="email" label="邮箱" min-width="170" show-overflow-tooltip />
      <el-table-column label="部门" min-width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ row.dept_name || '-' }}</template>
      </el-table-column>
      <el-table-column label="角色" min-width="170">
        <template #default="{ row }">
          <template v-if="row.roles && row.roles.length">
            <el-tag
              v-for="r in row.roles"
              :key="r.id"
              size="small"
              :type="roleTagType(r.code)"
              class="role-tag"
            >{{ ROLE_LABEL[r.code] || r.name }}</el-tag>
          </template>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="部门确认" width="90" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.dept_confirmed ? 'success' : 'danger'">
            {{ row.dept_confirmed ? '已确认' : '未确认' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'ACTIVE' ? 'success' : 'danger'">
            {{ row.status === 'ACTIVE' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="注册时间" min-width="150">
        <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="primary" size="small" @click="openRoles(row)">角色</el-button>
          <!-- 部门未确认时显示确认按钮 -->
          <el-button v-if="!row.dept_confirmed" link type="warning" size="small" @click="confirmDept(row)">
            确认部门
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页：移动端精简布局 -->
    <div class="pagination-wrap">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        :layout="pageLayout"
        background
        @current-change="load"
      />
    </div>

    <!-- 编辑用户对话框 -->
    <el-dialog v-model="editVisible" title="编辑用户" width="480px" :close-on-click-modal="false">
      <el-form ref="editFormRef" :model="editForm" label-width="80px">
        <el-form-item
          label="姓名"
          prop="name"
          :rules="[{ required: true, whitespace: true, message: '请输入姓名', trigger: 'blur' }]"
        >
          <el-input v-model="editForm.name" placeholder="请输入姓名" maxlength="50" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch
            v-model="editForm.status"
            active-text="启用"
            inactive-text="停用"
            :before-change="beforeStatusChange"
          />
          <div v-if="!editForm.status" class="text-danger switch-warn">停用后该用户将无法登录系统</div>
        </el-form-item>
        <el-form-item
          label="部门"
          prop="deptId"
          :rules="[{ required: true, message: '请选择部门', trigger: 'change' }]"
        >
          <el-select v-model="editForm.deptId" class="w-full" placeholder="请选择部门">
            <el-option v-for="d in deptOptions" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
          <div class="text-muted dept-tip">修改部门会影响审批流归属，请谨慎操作</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 授予角色对话框 -->
    <el-dialog v-model="roleVisible" title="授予角色" width="480px" :close-on-click-modal="false">
      <div class="text-muted role-note">说明：角色授予/变更操作会写入审计日志。</div>
      <el-checkbox-group v-model="roleForm" class="role-grid">
        <el-checkbox v-for="r in roleOptions" :key="r.id" :value="r.id">
          {{ r.name }}（{{ r.code }}）
        </el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="roleVisible = false">取消</el-button>
        <el-button type="primary" :loading="roleSaving" @click="saveRoles">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
/**
 * 管理后台 - 用户管理（路由 /admin/users）
 * 功能：关键词/部门/角色筛选、编辑用户（姓名/状态/部门）、确认部门归属、授予角色。
 * 操作成功后刷新列表；SSE/轮询检测到业务变化（refreshTick）时自动刷新。
 */
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  adminListUsers,
  adminUpdateUser,
  adminSetRoles,
  adminListRoles,
  adminListDepartments,
} from '@/api';
import { ROLE_LABEL, formatDateTime } from '@/utils/format';
import { useNotifyStore } from '@/stores/notify';
import { useMobile } from '@/utils/useMobile';

const notify = useNotifyStore();
const isMobile = useMobile();

/* ---------- 列表与筛选 ---------- */
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const filters = reactive({ keyword: '', deptId: null, roleId: null });

const deptOptions = ref([]); // 部门下拉选项（adminListDepartments）
const roleOptions = ref([]); // 角色下拉选项（adminListRoles）

async function load() {
  loading.value = true;
  try {
    const data = await adminListUsers({
      keyword: filters.keyword || undefined,
      deptId: filters.deptId || undefined,
      roleId: filters.roleId || undefined,
      page: page.value,
      pageSize,
    });
    list.value = data.list || [];
    total.value = data.total || 0;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  page.value = 1;
  load();
}

function handleReset() {
  filters.keyword = '';
  filters.deptId = null;
  filters.roleId = null;
  page.value = 1;
  load();
}

// 实时刷新：SSE/轮询收到业务变化信号时重新加载列表（契约要求）
watch(() => notify.refreshTick, load);

/* ---------- 角色标签颜色 ---------- */
const ROLE_TAG_TYPE = {
  ADMIN: 'danger',
  FINANCE: 'warning',
  DEPT_HEAD: 'success',
  COMPANY_HEAD: 'primary',
  EMPLOYEE: 'info',
};
function roleTagType(code) {
  return ROLE_TAG_TYPE[code] || 'info';
}

/* ---------- 编辑用户 ---------- */
const editVisible = ref(false);
const saving = ref(false);
const editing = ref(null); // 当前操作的行数据
const editFormRef = ref();
const editForm = reactive({ name: '', status: true, deptId: null });

function openEdit(row) {
  editing.value = row;
  editForm.name = row.name || '';
  editForm.status = row.status === 'ACTIVE';
  editForm.deptId = row.dept_id;
  editVisible.value = true;
}

/** 停用警告：从启用切到停用前二次确认（停用后无法登录） */
function beforeStatusChange() {
  if (!editForm.status) return true; // 停用 → 启用，无需确认
  return ElMessageBox.confirm('停用后该用户将无法登录，是否继续？', '停用确认', {
    type: 'warning',
    confirmButtonText: '确认停用',
    cancelButtonText: '取消',
  })
    .then(() => true)
    .catch(() => false);
}

async function saveEdit() {
  // 表单校验失败时静默返回（Element Plus 已在表单项展示错误提示）
  const valid = await editFormRef.value.validate().catch(() => false);
  if (!valid) return;
  // 修改部门需谨慎：变更前二次确认
  if (editForm.deptId !== editing.value.dept_id) {
    const dept = deptOptions.value.find((d) => d.id === editForm.deptId);
    try {
      await ElMessageBox.confirm(
        `部门将变更为「${dept ? dept.name : ''}」，可能影响审批流归属，确定继续吗？`,
        '修改部门确认',
        { type: 'warning' }
      );
    } catch {
      return;
    }
  }
  saving.value = true;
  try {
    await adminUpdateUser(editing.value.id, {
      name: editForm.name.trim(),
      status: editForm.status ? 'ACTIVE' : 'DISABLED',
      deptId: editForm.deptId,
    });
    ElMessage.success('用户信息已更新');
    editVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

/* ---------- 确认部门归属（仅 dept_confirmed=0 时可用） ---------- */
async function confirmDept(row) {
  try {
    await ElMessageBox.confirm(
      `确认用户「${row.name || row.username}」的部门归属为「${row.dept_name || '未填写'}」？确认后该用户方可提交申请。`,
      '确认部门归属',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  try {
    await adminUpdateUser(row.id, { deptConfirmed: true });
    ElMessage.success('部门归属已确认');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

/* ---------- 授予角色 ---------- */
const roleVisible = ref(false);
const roleSaving = ref(false);
const roleForm = ref([]); // 勾选的角色 id 集合

function openRoles(row) {
  editing.value = row;
  roleForm.value = (row.roles || []).map((r) => r.id);
  roleVisible.value = true;
}

async function saveRoles() {
  roleSaving.value = true;
  try {
    await adminSetRoles(editing.value.id, roleForm.value);
    ElMessage.success('角色已更新');
    roleVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    roleSaving.value = false;
  }
}

/* ---------- 分页布局（移动端精简） ---------- */
const pageLayout = computed(() =>
  isMobile.value ? 'prev, pager, next' : 'total, prev, pager, next, jumper'
);

/* ---------- 初始化 ---------- */
onMounted(async () => {
  load();
  try {
    const [roles, depts] = await Promise.all([adminListRoles(), adminListDepartments()]);
    roleOptions.value = roles || [];
    deptOptions.value = depts || [];
  } catch (e) {
    ElMessage.error(e.message);
  }
});
</script>

<style scoped>
.role-tag {
  margin: 2px 4px 2px 0;
}
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.switch-warn,
.dept-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
}
.switch-warn {
  margin-top: 4px;
}
.role-note {
  margin-bottom: 12px;
}
.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 4px 8px;
}
/* 移动端：分页居中、按钮组可换行 */
@media (max-width: 768px) {
  .pagination-wrap {
    justify-content: center;
  }
}
</style>
