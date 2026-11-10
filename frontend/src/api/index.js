/**
 * API 契约层：所有后端接口的封装（响应统一解包为 data）。
 * 错误处理：非 0 响应抛出 Error(message)；401 自动跳登录。
 * 金额约定：元→分由表单层调用 yuanToCents 转换；服务端返回一律为分。
 */
import axios from 'axios';

const http = axios.create({ baseURL: '/api', timeout: 30000 });

http.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

http.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && body.code === 0) return body.data;
    const err = new Error((body && body.message) || '请求失败');
    err.errors = body && body.errors;
    err.code = body && body.code;
    return Promise.reject(err);
  },
  (err) => {
    const r = err.response;
    const msg = (r && r.data && r.data.message) || err.message || '网络错误';
    if (r && r.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    const e = new Error(msg);
    e.code = r ? r.status : 0;
    e.errors = r && r.data && r.data.errors;
    return Promise.reject(e);
  }
);

const get = (url, params) => http.get(url, { params });
const post = (url, data) => http.post(url, data);
const put = (url, data) => http.put(url, data);
const patch = (url, data) => http.patch(url, data);
const del = (url, params) => http.delete(url, { params });

/* ================= 认证 / 用户 ================= */
export const login = (account, password) => post('/auth/login', { account, password });
export const logout = () => post('/auth/logout');
export const register = (payload) => post('/auth/register', payload);
export const getMe = () => get('/users/me');
export const updateMe = (payload) => patch('/users/me', payload);
export const searchUsers = (keyword, excludeSelf = false) =>
  get('/users/search', { keyword, excludeSelf: excludeSelf ? '1' : '0' });
export const listDepartments = () => get('/departments');

/* ================= 申请 ================= */
export const listApplications = (params) => get('/applications', params);
export const createApplication = (payload) => post('/applications', payload);
export const getApplication = (id) => get(`/applications/${id}`);
export const updateApplication = (id, payload) => patch(`/applications/${id}`, payload);
export const submitApplication = (id) => post(`/applications/${id}/submit`);
export const withdrawApplication = (id) => post(`/applications/${id}/withdraw`);
export const remindApplication = (id) => post(`/applications/${id}/remind`);
export const copyApplication = (id) => post(`/applications/${id}/copy`);
export const deleteApplication = (id) => del(`/applications/${id}`);

/* ================= 审批任务 ================= */
export const listTasks = (scope) => get('/tasks', { scope });
export const approveTask = (instanceId, comment) => post(`/tasks/${instanceId}/approve`, { comment });
export const rejectTask = (instanceId, reason) => post(`/tasks/${instanceId}/reject`, { reason });

/* ================= 附件 ================= */
export function uploadAttachment(applicationId, bizType, file) {
  const fd = new FormData();
  fd.append('application_id', applicationId);
  fd.append('biz_type', bizType);
  fd.append('file', file);
  return http.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
}
export const deleteAttachment = (id) => del(`/attachments/${id}`);
/** 预览/下载地址（接口支持 query.token 认证，供 <img>/新窗口使用） */
export const attachmentContentUrl = (id) => `/api/attachments/${id}/content?token=${encodeURIComponent(localStorage.getItem('token') || '')}`;
export const attachmentDownloadUrl = (id) => `/api/attachments/${id}/download?token=${encodeURIComponent(localStorage.getItem('token') || '')}`;

/* ================= 通知 ================= */
export const listNotifications = (params) => get('/notifications', params);
export const getUnreadCount = () => get('/notifications/unread-count');
export const readAllNotifications = () => patch('/notifications/read-all');
export const readNotification = (id) => patch(`/notifications/${id}/read`);
export const getStreamTicket = () => get('/notifications/stream-ticket');

/* ================= 统计 ================= */
export const personalStats = () => get('/stats/personal');
export const deptStats = () => get('/stats/dept');

/* ================= 模板 / 委托 / 配置 ================= */
export const publishedTemplates = () => get('/templates/published');
export const listDelegations = () => get('/delegations');
export const createDelegation = (payload) => post('/delegations', payload);
export const updateDelegation = (id, payload) => patch(`/delegations/${id}`, payload);
export const deleteDelegation = (id) => del(`/delegations/${id}`);
export const publicConfig = () => get('/config/public');
export const pushSubscribe = (sub) => post('/push/subscribe', sub);

/* ================= 管理后台 ================= */
export const adminListUsers = (params) => get('/admin/users', params);
export const adminUpdateUser = (id, payload) => patch(`/admin/users/${id}`, payload);
export const adminSetRoles = (id, roleIds) => put(`/admin/users/${id}/roles`, { roleIds });
export const adminListRoles = () => get('/admin/roles');
export const adminListDepartments = () => get('/admin/departments');
export const adminCreateDepartment = (payload) => post('/admin/departments', payload);
export const adminUpdateDepartment = (id, payload) => patch(`/admin/departments/${id}`, payload);
export const adminDeleteDepartment = (id) => del(`/admin/departments/${id}`);
export const adminListTemplates = () => get('/admin/templates');
export const adminCreateTemplate = (payload) => post('/admin/templates', payload);
export const adminUpdateTemplate = (id, payload) => put(`/admin/templates/${id}`, payload);
export const adminPublishTemplate = (id) => post(`/admin/templates/${id}/publish`);
export const adminToggleTemplate = (id) => post(`/admin/templates/${id}/toggle`);
export const adminGetConfig = () => get('/admin/config');
export const adminUpdateConfig = (payload) => patch('/admin/config', payload);
export const adminListAuditLogs = (params) => get('/admin/audit-logs', params);
export const adminStats = () => get('/admin/stats');
export const adminListStatsGrants = () => get('/admin/stats-grants');
export const adminCreateStatsGrant = (payload) => post('/admin/stats-grants', payload);
export const adminDeleteStatsGrant = (id) => del(`/admin/stats-grants/${id}`);
