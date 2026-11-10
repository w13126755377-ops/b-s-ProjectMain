<template>
  <el-container class="layout">
    <el-header class="header" height="56px">
      <div class="header-inner">
        <div class="brand">
          <el-icon v-if="isMobile" class="menu-trigger" @click="drawer = true"><Menu /></el-icon>
          <el-icon class="logo"><Stamp /></el-icon>
          <span class="brand-name">企业审批系统</span>
        </div>

        <el-menu
          v-if="!isMobile"
          mode="horizontal"
          :default-active="activePath"
          :ellipsis="false"
          router
          class="nav"
        >
          <el-menu-item index="/dashboard">工作台</el-menu-item>
          <el-menu-item index="/apps">我的申请</el-menu-item>
          <el-menu-item index="/apps/new">发起申请</el-menu-item>
          <el-menu-item index="/tasks">审批任务</el-menu-item>
        </el-menu>

        <div class="right">
          <el-badge :value="notify.unread" :hidden="!notify.unread" :max="99" class="bell">
            <el-icon class="bell-icon" @click="$router.push('/notifications')"><Bell /></el-icon>
          </el-badge>
          <el-dropdown v-if="!isMobile" @command="onCommand">
            <span class="user-chip">
              <el-avatar :size="28" class="avatar">{{ (auth.user?.name || '?')[0] }}</el-avatar>
              <span class="user-name">{{ auth.user?.name }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile"><el-icon><User /></el-icon>个人中心</el-dropdown-item>
                <el-dropdown-item command="delegations"><el-icon><Switch /></el-icon>我的委托</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin" command="admin"><el-icon><Setting /></el-icon>管理后台</el-dropdown-item>
                <el-dropdown-item divided command="logout"><el-icon><SwitchButton /></el-icon>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </el-header>

    <el-main class="main">
      <div class="page">
        <router-view />
      </div>
    </el-main>

    <!-- 移动端抽屉菜单 -->
    <el-drawer v-model="drawer" direction="ltr" size="240px" :with-header="false">
      <div class="drawer-user">
        <el-avatar :size="36" class="avatar">{{ (auth.user?.name || '?')[0] }}</el-avatar>
        <div>
          <div class="drawer-name">{{ auth.user?.name }}</div>
          <div class="drawer-dept">{{ auth.user?.dept_name || '—' }}</div>
        </div>
      </div>
      <el-menu :default-active="activePath" router @select="drawer = false">
        <el-menu-item index="/dashboard"><el-icon><Odometer /></el-icon>工作台</el-menu-item>
        <el-menu-item index="/apps"><el-icon><Tickets /></el-icon>我的申请</el-menu-item>
        <el-menu-item index="/apps/new"><el-icon><CirclePlus /></el-icon>发起申请</el-menu-item>
        <el-menu-item index="/tasks"><el-icon><Checked /></el-icon>审批任务</el-menu-item>
        <el-menu-item index="/notifications"><el-icon><Bell /></el-icon>通知中心</el-menu-item>
        <el-menu-item index="/profile"><el-icon><User /></el-icon>个人中心</el-menu-item>
        <el-menu-item index="/delegations"><el-icon><Switch /></el-icon>我的委托</el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/admin/stats"><el-icon><Setting /></el-icon>管理后台</el-menu-item>
        <el-menu-item index="logout" @click="onLogout"><el-icon><SwitchButton /></el-icon>退出登录</el-menu-item>
      </el-menu>
    </el-drawer>
  </el-container>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { useNotifyStore } from '@/stores/notify';
import { useMobile } from '@/utils/useMobile';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const notify = useNotifyStore();
const isMobile = useMobile();
const drawer = ref(false);

// 详情/编辑页高亮对应列表菜单
const activePath = computed(() => {
  if (route.path.startsWith('/apps')) return '/apps';
  if (route.path.startsWith('/tasks')) return '/tasks';
  if (route.path.startsWith('/notifications')) return '/notifications';
  if (route.path.startsWith('/profile')) return '/profile';
  if (route.path.startsWith('/delegations')) return '/delegations';
  return route.path;
});

async function onCommand(cmd) {
  if (cmd === 'profile') router.push('/profile');
  else if (cmd === 'delegations') router.push('/delegations');
  else if (cmd === 'admin') router.push('/admin/stats');
  else if (cmd === 'logout') onLogout();
}

async function onLogout() {
  try {
    await ElMessageBox.confirm('确定退出登录吗？', '提示', { type: 'warning' });
  } catch { return; }
  await auth.logout();
  router.push('/login');
}
</script>

<style scoped>
.layout { min-height: 100vh; }
.header {
  background: #fff; border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 0; position: sticky; top: 0; z-index: 100;
}
.header-inner {
  max-width: 1200px; margin: 0 auto; height: 56px;
  display: flex; align-items: center; gap: 16px; padding: 0 16px;
}
.brand { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.logo { font-size: 24px; color: var(--el-color-primary); }
.brand-name { font-weight: 700; font-size: 17px; white-space: nowrap; }
.menu-trigger { font-size: 22px; cursor: pointer; }
.nav { flex: 1; border-bottom: none; }
.right { display: flex; align-items: center; gap: 16px; }
.bell-icon { font-size: 20px; cursor: pointer; color: var(--el-text-color-primary); }
.user-chip { display: flex; align-items: center; gap: 6px; cursor: pointer; outline: none; }
.avatar { background: var(--el-color-primary); color: #fff; font-weight: 600; }
.user-name { font-size: 14px; }
.main { background: var(--el-fill-color-light); padding: 16px; }
.page { max-width: 1200px; margin: 0 auto; }

.drawer-user { display: flex; align-items: center; gap: 10px; padding: 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.drawer-name { font-weight: 600; }
.drawer-dept { font-size: 12px; color: var(--el-text-color-secondary); }

@media (max-width: 768px) {
  .main { padding: 8px; }
  .header-inner { gap: 10px; padding: 0 10px; }
}
</style>
