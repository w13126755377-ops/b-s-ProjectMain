import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes = [
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true, title: '登录' } },
  { path: '/register', name: 'register', component: () => import('@/views/Register.vue'), meta: { public: true, title: '注册' } },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/Dashboard.vue'), meta: { title: '工作台' } },
      { path: 'apps', name: 'apps', component: () => import('@/views/MyApplications.vue'), meta: { title: '我的申请' } },
      { path: 'apps/new', name: 'app-new', component: () => import('@/views/ApplicationCreate.vue'), meta: { title: '发起申请' } },
      { path: 'apps/:id/edit', name: 'app-edit', component: () => import('@/views/ApplicationCreate.vue'), meta: { title: '编辑草稿' } },
      { path: 'apps/:id', name: 'app-detail', component: () => import('@/views/ApplicationDetail.vue'), meta: { title: '申请详情' } },
      { path: 'tasks', name: 'tasks', component: () => import('@/views/Tasks.vue'), meta: { title: '审批任务' } },
      { path: 'notifications', name: 'notifications', component: () => import('@/views/Notifications.vue'), meta: { title: '通知中心' } },
      { path: 'profile', name: 'profile', component: () => import('@/views/Profile.vue'), meta: { title: '个人中心' } },
      { path: 'delegations', name: 'delegations', component: () => import('@/views/Delegations.vue'), meta: { title: '我的委托' } },
    ],
  },
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { admin: true },
    children: [
      { path: '', redirect: '/admin/stats' },
      { path: 'stats', name: 'admin-stats', component: () => import('@/views/admin/AdminStats.vue'), meta: { title: '数据统计' } },
      { path: 'users', name: 'admin-users', component: () => import('@/views/admin/AdminUsers.vue'), meta: { title: '用户管理' } },
      { path: 'departments', name: 'admin-departments', component: () => import('@/views/admin/AdminDepartments.vue'), meta: { title: '部门管理' } },
      { path: 'templates', name: 'admin-templates', component: () => import('@/views/admin/AdminTemplates.vue'), meta: { title: '流程模板' } },
      { path: 'config', name: 'admin-config', component: () => import('@/views/admin/AdminConfig.vue'), meta: { title: '系统配置' } },
      { path: 'audit', name: 'admin-audit', component: () => import('@/views/admin/AdminAudit.vue'), meta: { title: '审计日志' } },
      { path: 'grants', name: 'admin-grants', component: () => import('@/views/admin/AdminGrants.vue'), meta: { title: '统计授权' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  document.title = (to.meta.title ? `${to.meta.title} - ` : '') + '企业审批系统';
  const auth = useAuthStore();
  if (to.meta.public) {
    if (auth.token && (to.path === '/login' || to.path === '/register')) return '/';
    return true;
  }
  if (!auth.token) return { path: '/login', query: { redirect: to.fullPath } };
  if (to.meta.admin && !auth.isAdmin) return '/dashboard';
  return true;
});

export default router;
