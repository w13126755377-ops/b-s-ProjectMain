/**
 * 附件路由：上传 / 删除 / 预览 / 下载。
 * 权限（服务端强制）：
 * - 上传/删除：申请人本人 + 草稿状态
 * - 预览/下载：申请人本人或审批链成员（ADMIN 无默认权限——管理权限 ≠ 审批权限）
 * - biz_type 由服务端校验与申请类型一致（防票据伪装绕过票据规则）
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound, ok, asyncHandler } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { config } from '../config.js';
import { md5Buffer, isAllowedFile } from '../utils/helpers.js';

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);

await fs.mkdir(config.upload.dir, { recursive: true });

/** 业务类型 ↔ 申请类型 一致性（服务端校验，客户端指定无效） */
const BIZ_TYPE_OF_APP = {
  PROCUREMENT: ['QUOTATION'],
  TRAVEL: ['TRAVEL'],
  REIMBURSEMENT: ['RECEIPT'],
  CUSTOM: ['CUSTOM'],
};

const storage = multer.diskStorage({
  destination: config.upload.dir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (isAllowedFile(file.mimetype, ext)) return cb(null, true);
    cb(new AppError(400, '仅支持 JPEG / PNG / PDF 格式的票据与附件'));
  },
});

/** 上传。biz_type 必须与申请类型一致；仅草稿可上传；校验数量与总大小上限。 */
attachmentsRouter.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('请选择要上传的文件（JPEG/PNG/PDF，单文件 ≤10MB）');
  const applicationId = Number(req.body.application_id);
  const bizType = String(req.body.biz_type || '').toUpperCase();
  if (!applicationId) {
    await fs.unlink(req.file.path).catch(() => {});
    throw badRequest('缺少 application_id');
  }
  const app = await queryOne('SELECT * FROM applications WHERE id = ?', [applicationId]);
  if (!app) { await fs.unlink(req.file.path).catch(() => {}); throw notFound('申请不存在'); }
  if (app.applicant_id !== req.user.id) {
    await fs.unlink(req.file.path).catch(() => {});
    throw forbidden('只能为本人申请上传附件');
  }
  if (app.status !== 'DRAFT') {
    await fs.unlink(req.file.path).catch(() => {});
    throw conflict('只有草稿阶段可以上传附件');
  }
  const allowed = BIZ_TYPE_OF_APP[app.type] || [];
  if (!allowed.includes(bizType)) {
    await fs.unlink(req.file.path).catch(() => {});
    throw badRequest(`附件类型 ${bizType} 不适用于该申请类型（${app.type}）`);
  }
  // 数量与总大小限制（配置项可调）
  const countRows = await query('SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS total FROM attachments WHERE application_id = ?', [applicationId]);
  const maxCount = Number(await getConfig('receipt_max_count') || 20);
  const maxTotalMb = Number(await getConfig('receipt_max_total_mb') || 100);
  if (countRows[0].c >= maxCount) {
    await fs.unlink(req.file.path).catch(() => {});
    throw conflict(`附件数量已达上限（${maxCount} 个）`);
  }
  if (countRows[0].total + req.file.size > maxTotalMb * 1024 * 1024) {
    await fs.unlink(req.file.path).catch(() => {});
    throw conflict(`附件总大小超过上限（${maxTotalMb}MB）`);
  }

  const md5 = md5Buffer(await fs.readFile(req.file.path));
  const r = await query(
    `INSERT INTO attachments (application_id, biz_type, original_name, stored_name, mime, size_bytes, md5, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [applicationId, bizType, req.file.originalname, req.file.filename,
     req.file.mimetype, req.file.size, md5, req.user.id]
  );
  ok(res, {
    id: r.insertId, originalName: req.file.originalname, mime: req.file.mimetype,
    sizeBytes: req.file.size, uploadedAt: new Date().toISOString(),
  }, '上传成功');
}));

async function getConfig(key) {
  const row = await queryOne('SELECT value FROM system_configs WHERE `key` = ?', [key]);
  return row ? row.value : null;
}

/** 删除（仅草稿）。物理文件引用归零后删除。 */
attachmentsRouter.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), asyncHandler(async (req, res) => {
  const att = await queryOne('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (!att) throw notFound('附件不存在');
  const app = await queryOne('SELECT * FROM applications WHERE id = ?', [att.application_id]);
  if (!app || app.applicant_id !== req.user.id) throw forbidden('只能删除本人申请的附件');
  if (app.status !== 'DRAFT') throw conflict('只有草稿阶段可以删除附件');
  await query('DELETE FROM attachments WHERE id = ?', [req.params.id]);
  const refs = await query('SELECT COUNT(*) AS c FROM attachments WHERE stored_name = ?', [att.stored_name]);
  if (refs[0].c === 0) {
    await fs.unlink(path.join(config.upload.dir, att.stored_name)).catch(() => {});
  }
  ok(res, null, '已删除');
}));

/** 预览/下载统一鉴权：申请人本人或审批链成员 */
async function assertAttachmentAccess(user, att) {
  const app = await queryOne('SELECT * FROM applications WHERE id = ?', [att.application_id]);
  if (!app) throw notFound('申请不存在');
  if (app.applicant_id === user.id) return app;
  const inst = await queryOne('SELECT * FROM process_instances WHERE application_id = ? ORDER BY id DESC LIMIT 1', [app.id]);
  if (inst) {
    const snapshot = typeof inst.flow_snapshot === 'string' ? JSON.parse(inst.flow_snapshot) : inst.flow_snapshot;
    const nodes = (snapshot && snapshot.nodes) || [];
    if (nodes.some((n) => n.resolved_user_id === user.id || n.delegated_from === user.id)) return app;
  }
  throw forbidden('没有权限访问该附件');
}

const sendFile = (inline) => asyncHandler(async (req, res) => {
  const att = await queryOne('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (!att) throw notFound('附件不存在');
  await assertAttachmentAccess(req.user, att);
  const filePath = path.join(config.upload.dir, att.stored_name);
  try {
    await fs.access(filePath);
  } catch {
    throw notFound('文件已不存在');
  }
  res.setHeader('Content-Type', att.mime);
  res.setHeader('Content-Disposition',
    inline
      ? `inline; filename*=UTF-8''${encodeURIComponent(att.original_name)}`
      : `attachment; filename*=UTF-8''${encodeURIComponent(att.original_name)}`);
  res.sendFile(filePath);
});

attachmentsRouter.get('/:id/content', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), sendFile(true));
attachmentsRouter.get('/:id/download', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), sendFile(false));
