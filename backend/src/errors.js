/**
 * 统一错误模型与中间件。
 * 响应约定：成功 { code: 0, data, message }；失败 { code, message, errors? }
 * HTTP 状态码与业务 code 一致（400/401/403/404/409/413/500）。
 */
export class AppError extends Error {
  constructor(status, message, errors = undefined) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export const badRequest = (msg, errors) => new AppError(400, msg, errors);
export const unauthorized = (msg = '未登录或登录已过期') => new AppError(401, msg);
export const forbidden = (msg = '没有权限执行该操作') => new AppError(403, msg);
export const notFound = (msg = '资源不存在') => new AppError(404, msg);
export const conflict = (msg) => new AppError(409, msg);

/** 包装 async 路由处理器，异常统一交给错误中间件 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 统一错误处理中间件（必须最后注册） */
export function errorMiddleware(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ code: err.status, message: err.message, errors: err.errors });
  }
  // multer 文件大小超限
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ code: 413, message: '文件大小超过限制（单文件最大 10MB）' });
  }
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ code: 400, message: `文件上传失败：${err.message}` });
  }
  // JSON 解析失败
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 400, message: '请求体不是合法的 JSON' });
  }
  console.error('[UnhandledError]', err);
  return res.status(500).json({ code: 500, message: '服务器内部错误，请稍后重试' });
}

/** 成功响应助手 */
export function ok(res, data = null, message = 'ok') {
  return res.json({ code: 0, data, message });
}
