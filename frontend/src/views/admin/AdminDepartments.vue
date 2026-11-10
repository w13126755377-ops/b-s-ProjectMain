<template>
  <div>
    <!-- 部门列表 -->
    <div class="card">
      <div class="flex-between flex-wrap gap8" style="margin-bottom: 12px;">
        <div class="card-title" style="margin: 0;">部门列表</div>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建部门</el-button>
      </div>
      <el-table :data="list" v-loading="loading">
        <el-table-column prop="name" label="部门名称" min-width="140" />
        <el-table-column label="描述" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.description || '-' }}</template>
        </el-table-column>
        <el-table-column prop="user_count" label="成员数" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.user_count > 0 ? 'success' : 'info'">{{ row.user_count }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新建 / 编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑部门' : '新建部门'" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" :label-position="isMobile ? 'top' : 'right'" label-width="80px">
        <el-form-item label="部门名称" prop="name">
          <el-input v-model="form.name" maxlength="50" show-word-limit placeholder="请输入部门名称" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="部门职责说明（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
/**
 * 部门管理：查看部门列表，支持新建 / 编辑 / 删除。
 * 删除时有用户的部门后端返回 409，提示文案原样展示给管理员。
 */
import { ref, reactive, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import {
  adminListDepartments, adminCreateDepartment, adminUpdateDepartment, adminDeleteDepartment,
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
    list.value = await adminListDepartments();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
// 业务数据变化时自动刷新列表
watch(() => notify.refreshTick, load);

/* ---------- 新建 / 编辑 ---------- */
const dialogVisible = ref(false);
const editingId = ref(null);
const saving = ref(false);
const formRef = ref();
const form = reactive({ name: '', description: '' });
const rules = {
  name: [
    { required: true, message: '请输入部门名称', trigger: 'blur' },
    { max: 50, message: '部门名称不能超过 50 字', trigger: 'blur' },
  ],
  description: [{ max: 200, message: '描述不能超过 200 字', trigger: 'blur' }],
};

function openCreate() {
  editingId.value = null;
  form.name = '';
  form.description = '';
  dialogVisible.value = true;
}

function openEdit(row) {
  editingId.value = row.id;
  form.name = row.name;
  form.description = row.description || '';
  dialogVisible.value = true;
}

async function onSubmit() {
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    const payload = { name: form.name.trim(), description: (form.description || '').trim() };
    if (editingId.value) {
      await adminUpdateDepartment(editingId.value, payload);
      ElMessage.success('部门已更新');
    } else {
      await adminCreateDepartment(payload);
      ElMessage.success('部门已创建');
    }
    dialogVisible.value = false;
    await load();
  } catch (e) {
    // 409「部门名称已存在」等冲突提示直接展示后端文案
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

/* ---------- 删除 ---------- */
async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除部门「${row.name}」吗？删除后不可恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    );
  } catch { return; }
  try {
    await adminDeleteDepartment(row.id);
    ElMessage.success('部门已删除');
    await load();
  } catch (e) {
    // 409「该部门下还有用户」：提示原样展示，不做二次包装
    ElMessage.error(e.message);
  }
}
</script>
