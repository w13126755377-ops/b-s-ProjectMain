/**
 * zod 校验中间件：校验 body/query/params。
 * 校验失败返回 400 + 字段级错误明细（前端映射到表单）。
 */
import { badRequest } from '../errors.js';

export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    try {
      if (body) {
        const r = body.safeParse(req.body);
        if (!r.success) return next(badRequest('请求参数校验失败', formatZod(r)));
        req.body = r.data;
      }
      if (query) {
        const r = query.safeParse(req.query);
        if (!r.success) return next(badRequest('查询参数校验失败', formatZod(r)));
        req.query = r.data;
      }
      if (params) {
        const r = params.safeParse(req.params);
        if (!r.success) return next(badRequest('路径参数校验失败', formatZod(r)));
        req.params = r.data;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function formatZod(result) {
  return result.error.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
}
