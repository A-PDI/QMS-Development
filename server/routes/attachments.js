'use strict';
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const upload = require('../middleware/upload');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RFC 5987 encoding for Content-Disposition filename* parameter so that a stored
// file name containing quotes, CR/LF, or non-ASCII characters cannot break the
// response header.
function encodeContentDispositionFilename(name) {
  const safeAscii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8Encoded = encodeURIComponent(String(name)).replace(/['()]/g, escape);
  return `filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`;
}

// Privileged roles bypass per-attachment ownership checks for delete.
function isPrivileged(user) {
  return user && (user.role === 'admin' || user.role === 'qc_manager');
}

// GET /api/attachments/:inspectionId
router.get('/:inspectionId', (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.inspectionId)) {
      return next(new AppError('Invalid inspection id', 400, 'VALIDATION_ERROR'));
    }
    const attachments = db.all(
      'SELECT id, file_name, mime_type, file_size_bytes, section_key, item_id, uploaded_at FROM inspection_attachments WHERE inspection_id = ? ORDER BY uploaded_at ASC',
      [req.params.inspectionId]
    );
    res.json({ attachments });
  } catch (err) {
    next(err);
  }
});

// POST /api/attachments/:inspectionId
router.post('/:inspectionId', upload.single('file'), async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.inspectionId)) {
      return next(new AppError('Invalid inspection id', 400, 'VALIDATION_ERROR'));
    }
    if (!req.file) {
      return next(new AppError('No file provided', 400, 'VALIDATION_ERROR'));
    }

    const inspection = db.get('SELECT id FROM inspections WHERE id = ?', [req.params.inspectionId]);
    if (!inspection) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return next(new AppError('Inspection not found', 404, 'NOT_FOUND'));
    }

    const attachmentId = uuidv4();
    const now = new Date().toISOString();
    const sectionKey = req.body.section_key || null;
    const itemId = req.body.item_id || null;

    db.run(
      `INSERT INTO inspection_attachments (id, inspection_id, uploaded_by, file_name, file_path, mime_type, file_size_bytes, section_key, item_id, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attachmentId,
        req.params.inspectionId,
        req.user.id,
        req.file.originalname,
        req.file.path,
        req.file.mimetype,
        req.file.size,
        sectionKey,
        itemId,
        now,
      ]
    );

    const attachment = db.get(
      'SELECT id, file_name, mime_type, file_size_bytes, section_key, item_id, uploaded_at FROM inspection_attachments WHERE id = ?',
      [attachmentId]
    );
    res.status(201).json({ attachment });
  } catch (err) {
    next(err);
  }
});

// GET /api/attachments/download/:id
router.get('/download/:id', (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return next(new AppError('Invalid attachment id', 400, 'VALIDATION_ERROR'));
    }

    const attachment = db.get('SELECT * FROM inspection_attachments WHERE id = ?', [req.params.id]);
    if (!attachment) {
      return next(new AppError('Attachment not found', 404, 'NOT_FOUND'));
    }

    // Guard against an attacker using a manipulated stored path to escape the uploads root.
    const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
    const resolvedPath = path.resolve(attachment.file_path);
    if (!resolvedPath.startsWith(uploadRoot + path.sep) && resolvedPath !== uploadRoot) {
      return next(new AppError('File path outside uploads root', 400, 'INVALID_PATH'));
    }

    if (!fs.existsSync(resolvedPath)) {
      return next(new AppError('File not found on disk', 404, 'FILE_NOT_FOUND'));
    }

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; ${encodeContentDispositionFilename(attachment.file_name)}`);

    const stream = fs.createReadStream(resolvedPath);
    stream.on('error', () => next(new AppError('Error reading file', 500, 'FILE_READ_ERROR')));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/attachments/:id
// Allowed when: the caller uploaded the attachment, OR they are admin / qc_manager.
router.delete('/:id', (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return next(new AppError('Invalid attachment id', 400, 'VALIDATION_ERROR'));
    }

    const attachment = db.get('SELECT * FROM inspection_attachments WHERE id = ?', [req.params.id]);
    if (!attachment) {
      return next(new AppError('Attachment not found', 404, 'NOT_FOUND'));
    }

    const isUploader = req.user && attachment.uploaded_by && attachment.uploaded_by === req.user.id;
    if (!isUploader && !isPrivileged(req.user)) {
      return next(new AppError('Not allowed to delete this attachment', 403, 'FORBIDDEN'));
    }

    // Only unlink if the stored path is inside the uploads root.
    const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
    const resolvedPath = path.resolve(attachment.file_path);
    if (resolvedPath.startsWith(uploadRoot + path.sep) && fs.existsSync(resolvedPath)) {
      try { fs.unlinkSync(resolvedPath); } catch (e) { console.warn('[attachments] unlink failed:', e.message); }
    }

    db.run('DELETE FROM inspection_attachments WHERE id = ?', [req.params.id]);

    res.json({ message: 'Attachment deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
