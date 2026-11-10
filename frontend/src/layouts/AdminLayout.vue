<template>
  <el-container class="admin-layout">
    <!-- 桌面端侧边栏 -->
    <el-aside v-if="!isMobile" width="210px" class="aside">
      <div class="aside-brand">
        <el-icon><Setting /></el-icon>
        <span>管理后台</span>
      </div>
      <el-menu :default-active="activePath" router class="aside-menu">
        <el-menu-item index="/admin/stats"><el-icon><DataAnalysis /></el-icon>数据统计</el-menu-item>
        <el-menu-item index="/admin/users"><el-icon><UserFilled /></el-icon>用户管理</el-menu-item>
        <el-menu-item index="/admin/departments"><el-icon><OfficeBuilding /></el-icon>部门管理</el-menu-item>
        <el-menu-item index="/admin/templates"><el-icon><SetUp /></el-icon>流程模板</el-menu-item>
        <el-menu-item index="/admin/config"><el-icon><Tools /></el-icon>系统配置</el-menu-item>
        <el-menu-item index="/admin/audit"><el-icon><Notebook /></el-icon>审计日志</el-menu-item>
        <el-menu-item index="/admin/grants"><el-icon><Lock /></el-icon>统计授权</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header" height="52px">
        <el-icon v-if="isMobile" class="menu-trigger" @click="drawer = true"><Menu /></el-icon>
        <div class="header-title">{{ $route.meta.title || '管理后台' }}</div>
        <div class="header-right">
          <el-button link :icon="Back" @click="$router.push('/dashboard')">返回工作台</el-button>
          <el-dropdown @command="onCommand">
            <span class="user-chip">
              <el-avatar :size="26" class="avatar">{{ (auth.user?.name || '?')[0] }}</el-avatar>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout"><el-icon><SwitchButton /></el-icon>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main">
        <div class="page">
          <router-view />
        </div>
      </el-main>
    </el-container>

    <!-- 移动端抽屉 -->
    <el-drawer v-model="drawer" direction="ltr" size="240px" :with-header="false">
      <div class="aside-brand"><el-icon><Setting /></el-icon><span>管理后台</span></div>
      <el-menu :default-active="activePath" router @select="drawer = false">
        <el-menu-item index="/admin/stats"><el-icon><DataAnalysis /></el-icon>数据统计</el-menu-item>
        <el-menu-item index="/admin/users"><el-icon><UserFilled /></el-icon>用户管理</el-menu-item>
        <el-menu-item index="/admin/departments"><el-icon><OfficeBuilding /></el-icon>部门管理</el-menu-item>
        <el-menu-item index="/admin/templates"><el-icon><SetUp /></el-icon>流程模板</el-menu-item>
        <el-menu-item index="/admin/config"><el-icon><Tools /></el-icon>系统配置</el-menu-item>
        <el-menu-item index="/admin/audit"><el-icon><Notebook /></el-icon>审计日志</el-menu-item>
        <el-menu-item index="/admin/grants"><el-icon><Lock /></el-icon>统计授权</el-menu-item>
      </el-menu>
    </el-drawer>
  </el-container>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { Back } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { useMobile } from '@/utils/useMobile';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const isMobile = useMobile();
const drawer = ref(false);

const activePath = computed(() => route.path);

async function onCommand(cmd) {
  if (cmd !== 'logout') return;
  try {
    await ElMessageBox.confirm('确定退出登录吗？', '提示', { type: 'warning' });
  } catch { return; }
  await auth.logout();
  router.push('/login');
}
</script>

<style scoped>
.admin-layout { min-height: 100vh; }
.aside {
  background: #fff; border-right: 1px solid var(--el-border-color-lighter);
  display: flex; flex-direction: column;
}
.aside-brand {
  height: 52px; display: flex; align-items: center; gap: 8px;
  padding: 0 18px; font-weight: 700; font-size: 15px;
  border-bottom: 1px solid var(--el-border-color-lighter); flex-shrink: 0;
}
.aside-menu { border-right: none; flex: 1; }
.header {
  background: #fff; border-bottom: 1px solid var(--el-border-color-lighter);
  display: flex; align-items: center; gap: 12px; padding: 0 16px;
}
.menu-trigger { font-size: 20px; cursor: pointer; }
.header-title { font-weight: 600; flex: 1; }
.header-right { display: flex; align-items: center; gap: 12px; }
.user-chip { cursor: pointer; outline: none; display: flex; align-items: center; }
.avatar { background: var(--el-color-primary); color: #fff; font-weight: 600; }
.main { background: var(--el-fill-color-light); padding: 16px; }
.page { max-width: 1100px; margin: 0 auto; }
@media (max-width: 768px) {
  .main { padding: 8px; }
}
</style>
