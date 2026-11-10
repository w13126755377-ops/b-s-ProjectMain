<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-logo">
        <el-icon :size="34" color="#409eff"><OfficeBuilding /></el-icon>
      </div>
      <h1 class="auth-title">企业审批系统</h1>
      <p class="auth-subtitle">采购 · 差旅 · 报销 · 自定义流程，一站式审批</p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large" @submit.prevent>
        <el-form-item label="账号" prop="account">
          <el-input
            v-model="form.account"
            placeholder="用户名或邮箱"
            :prefix-icon="User"
            autocomplete="username"
            clearable
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            autocomplete="current-password"
            show-password
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <!-- 回车提交：输入框 keyup.enter 已绑定，按钮兜底 -->
        <el-button type="primary" class="w-full" :loading="loading" @click="onSubmit">登 录</el-button>
      </el-form>

      <div class="auth-links">
        没有账号？<router-link class="auth-link" to="/register">立即注册</router-link>
      </div>
    </div>

    <!-- 页脚：演示账号提示 -->
    <p class="auth-footer">
      演示账号：admin / Admin@123（管理员）· zhangsan / Zhangsan@123（研发部负责人）<br />
      wangwu / Wangwu@123（财务）· sunqi / Sunqi@123（员工）
    </p>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Lock, User } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const formRef = ref();
const loading = ref(false);
const form = reactive({ account: '', password: '' });

// 前端校验（后端为最终防线，错误信息直接展示）
const rules = {
  account: [{ required: true, message: '请输入用户名或邮箱', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function onSubmit() {
  if (loading.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  try {
    await auth.login(form.account.trim(), form.password);
    ElMessage.success('登录成功');
    // 路由守卫会把被拦截前的目标页放在 redirect 上，登录后原路返回
    const redirect = route.query.redirect;
    router.push(typeof redirect === 'string' && redirect ? redirect : '/');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
/* 页面级垂直水平居中 + 品牌色渐变背景 */
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

/* 移动端：卡片内边距收紧，按钮触控友好 */
@media (max-width: 768px) {
  .auth-card {
    padding: 26px 18px;
    max-width: 400px;
  }
  .auth-footer {
    font-size: 11px;
  }
}
</style>
