import { defineStore } from 'pinia';
import { login as apiLogin, logout as apiLogout } from '@/api';
import { getMe } from '@/api';

/** 认证状态：token + 用户信息（localStorage 持久化） */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null'),
  }),
  getters: {
    isLogin: (s) => !!s.token,
    isAdmin: (s) => !!s.user && s.user.roleCodes.includes('ADMIN'),
    roleCodes: (s) => (s.user ? s.user.roleCodes : []),
    deptConfirmed: (s) => !!s.user && !!s.user.dept_confirmed,
  },
  actions: {
    setSession({ token, user }) {
      this.token = token;
      this.user = user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    },
    async login(account, password) {
      const data = await apiLogin(account, password);
      this.setSession(data);
      return data;
    },
    async fetchMe() {
      const user = await getMe();
      this.user = user;
      localStorage.setItem('user', JSON.stringify(user));
      return user;
    },
    async logout() {
      try { await apiLogout(); } catch { /* 忽略 */ }
      this.token = '';
      this.user = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    },
  },
});
