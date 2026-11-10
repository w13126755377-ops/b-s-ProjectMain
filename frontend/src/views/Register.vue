<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-logo">
        <el-icon :size="34" color="#409eff"><OfficeBuilding /></el-icon>
      </div>
      <h1 class="auth-title">注册账号</h1>
      <p class="auth-subtitle">部门归属需管理员确认，确认后方可提交申请</p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large" @submit.prevent>
        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="form.username"
            placeholder="3-20 位字母、数字或下划线"
            :prefix-icon="User"
            autocomplete="username"
            maxlength="20"
            clearable
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input
            v-model="form.name"
            placeholder="真实姓名"
            :prefix-icon="Postcard"
            maxlength="32"
            clearable
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input
            v-model="form.email"
            placeholder="用于登录与接收通知"
            :prefix-icon="Message"
            autocomplete="email"
            clearable
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="至少 8 位，须同时包含字母和数字"
            :prefix-icon="Lock"
            autocomplete="new-password"
            show-password
            @input="recheckConfirm"
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            :prefix-icon="Key"
            autocomplete="new-password"
            show-password
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-form-item label="申请加入部门" prop="deptId">
          <el-select
            v-model="form.deptId"
            placeholder="请选择申请加入的部门"
            class="w-full"
            :loading="deptLoading"
            filterable
          >
            <el-option v-for="d in departments" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-button type="primary" class="w-full" :loading="loading" @click="onSubmit">注 册</el-button>
      </el-form>

      <div class="auth-links">
        已有账号？<router-link class="auth-link" to="/login">去登录</router-link>
      </div>
    </div>

    <!-- 页脚：注册口径说明 -->
    <p class="auth-footer">
      注册即默认成为普通员工；部门归属与高权限角色由管理员确认授予
    </p>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Key, Lock, Message, Postcard, User } from '@element-plus/icons-vue';
import { listDepartments, register } from '@/api';

const router = useRouter();
const route = useRoute();

const formRef = ref();
const loading = ref(false);
const deptLoading = ref(false);
const departments = ref([]);

const form = reactive({
  username: '',
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  deptId: null,
});

// 前端校验（与服务端 zod 规则保持一致）
const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]{3,20}$/, message: '用户名须为 3-20 位字母、数字或下划线', trigger: 'blur' },
  ],
  name: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { max: 32, message: '姓名不能超过 32 个字符', trigger: 'blur' },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  password: [{ required: true, validator: validatePassword, trigger: 'blur' }],
  confirmPassword: [{ required: true, validator: validateConfirm, trigger: 'blur' }],
  deptId: [{ required: true, message: '请选择申请加入的部门', trigger: 'change' }],
};

// 密码强度：至少 8 位（不超过 64 位），且同时包含字母和数字
function validatePassword(_rule, value, callback) {
  if (!value) return callback(new Error('请输入密码'));
  if (value.length < 8) return callback(new Error('密码长度至少 8 个字符'));
  if (value.length > 64) return callback(new Error('密码长度不能超过 64 个字符'));
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) {
    return callback(new Error('密码须同时包含字母和数字'));
  }
  callback();
}

// 确认密码必须与密码一致
function validateConfirm(_rule, value, callback) {
  if (!value) return callback(new Error('请再次输入密码'));
  if (value !== form.password) return callback(new Error('两次输入的密码不一致'));
  callback();
}

// 修改密码后重校验确认密码，避免两次输入不一致的状态残留
function recheckConfirm() {
  if (form.confirmPassword && formRef.value) {
    formRef.value.validateField('confirmPassword').catch(() => {});
  }
}

/** 部门列表：GET /api/departments 为公开接口（注册选择部门），直接调用 */
async function loadDepartments() {
  deptLoading.value = true;
  try {
    departments.value = await listDepartments();
  } catch (e) {
    ElMessage.error(e.message || '部门列表加载失败');
  } finally {
    deptLoading.value = false;
  }
}

async function onSubmit() {
  if (loading.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  try {
    await register({
      username: form.username.trim(),
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      deptId: form.deptId,
    });
    ElMessage.success('注册成功，请登录');
    // 部门归属需管理员确认后方可提交申请
    ElMessage.info('部门归属需管理员确认后方可提交申请');
    router.push('/login');
  } catch (e) {
    // 服务端字段级错误（zod）尽量映射回对应表单项
    const errs = Array.isArray(e.errors) ? e.errors : [];
    if (errs.length) {
      errs.forEach((item) => {
        const field = item.path || '';
        if (form[field] !== undefined && formRef.value) {
          formRef.value.validateField([field]).catch(() => {});
        }
      });
      ElMessage.error(errs[0].message || e.message);
    } else {
      ElMessage.error(e.message);
    }
  } finally {
    loading.value = false;
  }
}

onMounted(loadDepartments);
</script>

<style scoped>
/* 页面级垂直水平居中 + 品牌色渐变背景（与登录页一致） */
.auth-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: linear-gradient(135deg, #409eff 0%, #2b5876 100%);
}

.auth-card {
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 12px;
  padding: 32px 28px;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.22);
}

.auth-logo {
  text-align: center;
  margin-bottom: 4px;
}

.auth-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  text-align: center;
  color: var(--el-text-color-primary);
}

.auth-subtitle {
  margin: 6px 0 22px;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.auth-links {
  margin-top: 16px;
  text-align: center;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.auth-link {
  color: var(--el-color-primary);
  text-decoration: none;
  margin-left: 4px;
}

.auth-link:hover {
  text-decoration: underline;
}

.auth-footer {
  margin: 18px 0 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.9;
  color: rgba(255, 255, 255, 0.88);
}

/* 移动端：卡片内边距收紧，按钮触控友好（表单已在全局媒体查询中单列全宽） */
@media (max-width: 768px) {
  .auth-card {
    padding: 24px 18px;
    max-width: 400px;
  }
  .auth-footer {
    font-size: 11px;
  }
}
</style>
