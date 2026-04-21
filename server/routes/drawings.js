'use strict';
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Configure upload for drawings
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));
const DRAWINGS_DIR = path.join(UPLOAD_DIR, 'drawings');

if (!fs.existsSync(DRAWINGS_DIR)) {
  fs.mkdirSync(DRAWINGS_DIR, { recursive: true });
}

function sanitiseFilenameBase(originalName) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').slice(0, 80) || 'file';
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  return { safeBase, safeExt };
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DRAWINGS_DIR);
  },
  filename: (req, file, cb) => {
    const { safeBase, safeExt } = sanitiseFilenameBase(file.originalname || 'drawing');
    const uuid = uuidv4().slice(0, 8);
    cb(null, `${safeBase}-${uuid}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF and image mime types
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new AppError('Only PDF and image files are allowed', 400, 'INVALID_FILE_TYPE'));
    }
  },
});

// GET /api/drawings?part_number=ABC123
router.get('/', (req, res, next) => {
  try {
    const { part_number } = req.query;

    let drawings;
    if (part_number) {
      drawings = db.all(
        `SELECT
          d.id, d.part_number, d.version, d.file_name, d.mime_type, d.file_size_bytes,
          d.notes, d.uploaded_by, u.name AS uploaded_by_name, d.is_current, d.created_at
         FROM engineering_drawings d
         LEFT JOIN users u ON d.uploaded_by = u.id
         WHERE d.part_number = ?
         ORDER BY d.created_at DESC`,
        [part_number]
      );
    } else {
      drawings = db.all(
        `SELECT
          d.id, d.part_number, d.version, d.file_name, d.mime_type, d.file_size_bytes,
          d.notes, d.uploaded_by, u.name AS uploaded_by_name, d.is_current, d.created_at
         FROM engineering_drawings d
         LEFT JOIN users u ON d.uploaded_by = u.id
         ORDER BY d.part_number ASC, d.created_at DESC`,
        []
      );
    }

    res.json({ drawings });
  } catch (err) {
    next(err);
  }
});

// POST /api/drawings — multipart upload
router.post('/', upload.single('drawing'), (req, res, next) => {
  try {
    const { part_number, version, notes } = req.body;

    if (!part_number || !version) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return next(new AppError('part_number and version are required', 400, 'VALIDATION_ERROR'));
    }

    if (!req.file) {
      return next(new AppError('No file provided', 400, 'VALIDATION_ERROR'));
    }

    const now = new Date().toISOString();
    const drawingId = uuidv4();

    // Set all existing drawings for this part_number to is_current = 0
    db.run('UPDATE engineering_drawings SET is_current = 0 WHERE part_number = ?', [part_number]);

    // Insert new drawing with is_current = 1
    db.run(
      `INSERT INTO engineering_drawings (id, part_number, version, file_name, file_path, mime_type, file_size_bytes, notes, uploaded_by, is_current, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        drawingId,
        part_number,
        version,
        req.file.originalname,
        req.file.path,
        req.file.mimetype,
        req.file.size,
        notes || null,
        req.user.id,
        now,
      ]
    );

    const drawing = db.get(
      `SELECT
        d.id, d.part_number, d.version, d.file_name, d.mime_type, d.file_size_bytes,
        d.notes, d.uploaded_by, u.name AS uploaded_by_name, d.is_current, d.created_at
       FROM engineering_drawings d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.id = ?`,
      [drawingId]
    );

    res.status(201).json({ drawing });
  } catch (err) {
    next(err);
  }
});

// GET /api/drawings/download/:id
router.get('/download/:id', (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return next(new AppError('Invalid drawing id', 400, 'VALIDATION_ERROR'));
    }

    const drawing = db.get('SELECT * FROM engineering_drawings WHERE id = ?', [req.params.id]);
    if (!drawing) {
      return next(new AppError('Drawing not found', 404, 'NOT_FOUND'));
    }

    // Guard against path traversal
    const resolvedPath = path.resolve(drawing.file_path);
    const drawingsRoot = path.resolve(DRAWINGS_DIR);
    if (!resolvedPath.startsWith(drawingsRoot + path.sep) && resolvedPath !== drawingsRoot) {
      return next(new AppError('File path outside drawings root', 400, 'INVALID_PATH'));
    }

    if (!fs.existsSync(resolvedPath)) {
      return next(new AppError('File not found on disk', 404, 'FILE_NOT_FOUND'));
    }

    res.setHeader('Content-Type', drawing.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${drawing.file_name}"`);

    const stream = fs.createReadStream(resolvedPath);
    stream.on('error', () => next(new AppError('Error reading file', 500, 'FILE_READ_ERROR')));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/drawings/:id/set-current
router.patch('/:id/set-current', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) {
      return next(new AppError('Unauthorized', 403));
    }

    if (!UUID_RE.test(req.params.id)) {
      return next(new AppError('Invalid drawing id', 400, 'VALIDATION_ERROR'));
    }

    const drawing = db.get('SELECT * FROM engineering_drawings WHERE id = ?', [req.params.id]);
    if (!drawing) {
      return next(new AppError('Drawing not found', 404, 'NOT_FOUND'));
    }

    const now = new Date().toISOString();

    // Set all drawings for this part_number to is_current = 0
    db.run('UPDATE engineering_drawings SET is_current = 0 WHERE part_number = ?', [drawing.part_number]);

    // Set this drawing to is_current = 1
    db.run('UPDATE engineering_drawings SET is_current = 1 WHERE id = ?', [req.params.id]);

    const updated = db.get(
      `SELECT
        d.id, d.part_number, d.version, d.file_name, d.mime_type, d.file_size_bytes,
        d.notes, d.uploaded_by, u.name AS uploaded_by_name, d.is_current, d.created_at
       FROM engineering_drawings d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.id = ?`,
      [req.params.id]
    );

    res.json({ drawing: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/drawings/:id
router.delete('/:id', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) {
      return next(new AppError('Unauthorized', 403));
    }

    if (!UUID_RE.test(req.params.id)) {
      return next(new AppError('Invalid drawing id', 400, 'VALIDATION_ERROR'));
    }

    const drawing = db.get('SELECT * FROM engineering_drawings WHERE id = ?', [req.params.id]);
    if (!drawing) {
      return next(new AppError('Drawing not found', 404, 'NOT_FOUND'));
    }

    // Delete file from disk if it exists and is inside drawings root
    const drawingsRoot = path.resolve(DRAWINGS_DIR);
    const resolvedPath = path.resolve(drawing.file_path);
    if (resolvedPath.startsWith(drawingsRoot + path.sep) && fs.existsSync(resolvedPath)) {
      try {
        fs.unlinkSync(resolvedPath);
      } catch (e) {
        console.warn('[drawings] unlink failed:', e.message);
      }
    }

    // Delete from database
    db.run('DELETE FROM engineering_drawings WHERE id = ?', [req.params.id]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
