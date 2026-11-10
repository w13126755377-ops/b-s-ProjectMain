/** 认证路由：注册 / 登录 / 退出 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, queryOne, transaction } from '../db.js';
import { badRequest, ok, unauthorized } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { hashPassword, verifyPassword, validatePassword } from '../utils/password.js';
import { config } from '../config.js';
import { asyncHandler } from '../errors.js';

export const authRouter = Router();

const registerSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/, '用户名须为 3-20 位字母、数字或下划线'),
  name: z.string().trim().min(1, '姓名不能为空').max(32),
  email: z.string().email('邮箱格式不正确').max(128),
  password: z.string(),
  deptId: z.number().int().positive('请选择申请加入的部门'),
});

/**
 * 注册：客户端不能指定角色——新用户一律为"普通员工"（EMPLOYEE）。
 * 部门归属及高权限角色由管理员在管理后台确认和授予（留痕）。
 */
authRouter.post('/register', validate({ body: registerSchema }), asyncHandler(async (req, res) => {
  const { username, name, email, password, deptId } = req.body;
  const pwErr = validatePassword(password);
  if (pwErr) throw badRequest(pwErr);

  const dept = await queryOne('SELECT id FROM departments WHERE id = ?', [deptId]);
  if (!dept) throw badRequest('所选部门不存在');

  const hash = hashPassword(password);
  try {
    await transaction(async (conn) => {
      const [r] = await conn.execute(
        `INSERT INTO users (username, email, password_hash, name, dept_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', NOW(), NOW())`,
        [username, email.toLowerCase(), hash, name, deptId]
      );
      await conn.execute(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT ?, id FROM roles WHERE code = 'EMPLOYEE'`,
        [r.insertId]
      );
    });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      throw badRequest('用户名或邮箱已被注册（用户名和邮箱必须唯一）');
    }
    throw err;
  }
  ok(res, null, '注册成功，请登录');
}));

const loginSchema = z.object({
  account: z.string().trim().min(1, '请输入用户名或邮箱'),
  password: z.string().min(1, '请输入密码'),
});

authRouter.post('/login', validate({ body: loginSchema }), asyncHandler(async (req, res) => {
  const { account, password } = req.body;
  const user = await queryOne(
    'SELECT * FROM users WHERE username = ? OR email = ?',
    [account, account.toLowerCase()]
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw unauthorized('用户名或密码错误');
  }
  if (user.status !== 'ACTIVE') throw unauthorized('账号已被停用，请联系管理员');
  const token = jwt.sign(
    { uid: user.id, username: user.username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
  const { loadUser } = await import('../middleware/auth.js');
  ok(res, { token, user: await loadUser(user.id) }, '登录成功');
}));

authRouter.post('/logout', asyncHandler(async (_req, res) => {
  // JWT 无状态：退出由客户端丢弃 token 完成；此接口为入口留痕
  ok(res, null, '已退出登录');
}));
