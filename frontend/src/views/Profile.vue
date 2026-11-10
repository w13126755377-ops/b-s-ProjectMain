<template>
  <div>
    <!-- 个人信息卡 -->
    <div class="card">
      <div class="profile-head flex-between flex-wrap gap8">
        <div class="flex gap16">
          <el-avatar :size="64" class="profile-avatar">{{ (auth.user?.name || '?')[0] }}</el-avatar>
          <div>
            <div class="profile-name">{{ auth.user?.name || '—' }}</div>
            <div class="text-muted">@{{ auth.user?.username || '—' }}</div>
          </div>
        </div>
        <el-button type="primary" plain @click="openEdit">
          <el-icon class="mr4"><EditPen /></el-icon>编辑资料
        </el-button>
      </div>

      <el-descriptions :column="isMobile ? 1 : 2" border class="mt16">
        <el-descriptions-item label="用户名">{{ auth.user?.username || '—' }}</el-descriptions-item>
        <el-descriptions-item label="姓名">{{ auth.user?.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="邮箱">{{ auth.user?.email || '—' }}</el-descriptions-item>
        <el-descriptions-item label="部门">{{ auth.user?.dept_name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="角色">
          <el-tag v-for="c in auth.roleCodes" :key="c" size="small" class="role-tag">
            {{ ROLE_LABEL[c] || c }}
          </el-tag>
          <span v-if="!auth.roleCodes.length" class="text-muted">普通员工</span>
        </el-descriptions-item>
        <el-descriptions-item label="部门归属">
          <!-- 部门未确认前无法提交申请 -->
          <el-tag :type="auth.deptConfirmed ? 'success' : 'warning'">
            {{ auth.deptConfirmed ? '已确认' : '待管理员确认（确认前无法提交申请）' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="注册时间">
          {{ formatDateTime(auth.user?.created_at) }}
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <!-- 修改密码 -->
    <div class="card">
      <h3 class="card-title">修改密码</h3>
      <el-form
        ref="pwdFormRef"
        :model="pwdForm"
        :rules="pwdRules"
        label-width="90px"
        class="pwd-form"
      >
        <el-form-item label="旧密码" prop="oldPassword">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password placeholder="请输入旧密码" />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirm">
          <el-input v-model="pwdForm.confirm" type="password" show-password placeholder="请再次输入新密码" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="pwdSaving" @click="changePassword">确认修改</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 编辑资料对话框 -->
    <el-dialog v-model="editVisible" title="编辑资料" width="480px" :close-on-click-modal="false">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="70px">
        <el-form-item label="姓名" prop="name">
          <el-input v-model="editForm.name" maxlength="32" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="editForm.email" maxlength="128" placeholder="请输入邮箱" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { updateMe } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useMobile } from '@/utils/useMobile';
import { formatDateTime, ROLE_LABEL } from '@/utils/format';

const router = useRouter();
const auth = useAuthStore();
const isMobile = useMobile();

/* ---------- 编辑资料 ---------- */
const editVisible = ref(false);
const editSaving = ref(false);
const editFormRef = ref();
const editForm = reactive({ name: '', email: '' });
const editRules = {
  name: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { max: 32, message: '姓名不超过 32 字', trigger: 'blur' },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
    { max: 128, message: '邮箱过长', trigger: 'blur' },
  ],
};

function openEdit() {
  editForm.name = auth.user?.name || '';
  editForm.email = auth.user?.email || '';
  editVisible.value = true;
}

async function saveEdit() {
  try {
    await editFormRef.value.validate();
  } catch { return; }
  editSaving.value = true;
  try {
    await updateMe({ name: editForm.name.trim(), email: editForm.email.trim() });
    await auth.fetchMe(); // 刷新本地用户信息
    ElMessage.success('资料已更新');
    editVisible.value = false;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    editSaving.value = false;
  }
}

/* ---------- 修改密码 ---------- */
const pwdFormRef = ref();
const pwdSaving = ref(false);
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' });
const pwdRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_r, v, cb) => (v === pwdForm.newPassword ? cb() : cb(new Error('两次输入的密码不一致'))),
      trigger: 'blur',
    },
  ],
};

async function changePassword() {
  try {
    await pwdFormRef.value.validate();
  } catch { return; }
  pwdSaving.value = true;
  try {
    await updateMe({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword });
    ElMessage.success('密码已修改，请重新登录');
    await auth.logout();
    router.push('/login');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    pwdSaving.value = false;
  }
}
</script>

<style scoped>
.mr4 { margin-right: 4px; }
.profile-head { align-items: center; }
.profile-avatar { background: var(--el-color-primary); color: #fff; font-weight: 600; font-size: 24px; }
.profile-name { font-size: 20px; font-weight: 700; line-height: 1.3; }
.role-tag { margin-right: 6px; margin-top: 2px; }

.pwd-form { max-width: 480px; }

@media (max-width: 768px) {
  .pwd-form { max-width: 100%; }
  .profile-head { justify-content: flex-start; }
}
</style>
