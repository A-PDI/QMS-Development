'use strict';
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');
const {
  LIMITS,
  UUID_RE,
  ncrUploadDir,
  isInsideUploads,
  removeImageFile,
  detectImageType,
  normalizeNcrFields,
  loadNcrContent,
  syncNcrContent,
  imageCount,
  addNcrImage,
  deleteNcr,
} = require('../services/ncrContent');
const { generateNcrPdf, ncrPdfFilename } = require('../services/ncrPdf');

// Admin-level roles. Matches ADMIN_ROLES in routes/inspections.js and
// client/src/lib/nav.js.
const ADMIN_ROLES = ['admin', 'qc_manager'];

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '25', 10);

function requireAdmin(req, res, next) {
  if (!ADMIN_ROLES.includes(req.user?.role)) return next(new AppError('Only admin users can delete NCRs', 403, 'FORBIDDEN'));
  next();
}

/** 404 unless :id is an existing NCR; stores it on req.ncr. */
function loadNcr(req, res, next) {
  try {
    const ncr = db.get('SELECT * FROM ncrs WHERE id = ?', [req.params.id]);
    if (!ncr) return next(new AppError('NCR not found', 404, 'NOT_FOUND'));
    req.ncr = ncr;
    next();
  } catch (err) { next(err); }
}

// Photos are written to uploads/ncrs/<ncrId>/. loadNcr has already confirmed
// the NCR exists, and ncrUploadDir rejects any id that is not a UUID.
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const dir = ncrUploadDir(req.params.id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) { cb(err); }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
});

function nextNcrNumber() {
  const row = db.get(`SELECT ncr_number FROM ncrs ORDER BY created_at DESC LIMIT 1`, []);
  if (!row) return 'NCR-0001';
  const match = (row.ncr_number || '').match(/(\d+)$/);
  const next = match ? parseInt(match[1]) + 1 : 1;
  return `NCR-${String(next).padStart(4, '0')}`;
}

function getNcrWithContent(id) {
  const ncr = db.get(
    `SELECT n.*, i.form_no, i.component_type, i.inspector_name FROM ncrs n
     LEFT JOIN inspections i ON i.id = n.inspection_id WHERE n.id = ?`,
    [id]
  );
  if (!ncr) return null;
  return { ...ncr, ...loadNcrContent(id) };
}

// GET /api/ncrs
router.get('/', (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql = `SELECT n.*, i.form_no, i.component_type FROM ncrs n LEFT JOIN inspections i ON i.id = n.inspection_id WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND n.status = ?'; params.push(status); }
    if (search) {
      sql += ' AND (n.part_number LIKE ? OR n.ncr_number LIKE ? OR n.supplier LIKE ? OR n.po_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    sql += ' ORDER BY n.created_at DESC';
    const countSql = sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as count FROM');
    const total = db.get(countSql, params).count;
    const ncrs = db.all(sql + ` LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    res.json({ ncrs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// POST /api/ncrs
router.post('/', (req, res, next) => {
  try {
    const { inspection_id } = req.body;
    const fields = normalizeNcrFields(req.body);
    if (!fields.description_of_defect) return next(new AppError('description_of_defect is required', 400, 'VALIDATION_ERROR'));

    const id = uuidv4();
    const ncr_number = nextNcrNumber();
    const now = new Date().toISOString();

    // Pull part info from inspection if not provided
    let partNumber = fields.part_number, supplierVal = fields.supplier, poNumber = fields.po_number;
    if (inspection_id) {
      const insp = db.get('SELECT part_number, supplier, po_number FROM inspections WHERE id = ?', [inspection_id]);
      if (!insp) return next(new AppError('Linked inspection not found', 400, 'VALIDATION_ERROR'));
      partNumber = partNumber || insp.part_number;
      supplierVal = supplierVal || insp.supplier;
      poNumber = poNumber || insp.po_number;
    }

    db.run(
      `INSERT INTO ncrs (id, ncr_number, inspection_id, part_number, supplier, po_number,
         description_of_defect, quantity_affected, severity, ncr_disposition,
         corrective_action_required, corrective_action_due_date,
         status, created_by, created_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, ncr_number, inspection_id || null, partNumber || null, supplierVal || null, poNumber || null,
        fields.description_of_defect, fields.quantity_affected ?? null, fields.severity || 'major',
        fields.ncr_disposition || 'pending', fields.corrective_action_required || 0,
        fields.corrective_action_due_date || null, fields.status || 'open',
        req.user.id, req.user.name || null, now, now,
      ]
    );
    if (fields.status === 'closed') db.run('UPDATE ncrs SET closed_at = ? WHERE id = ?', [now, id]);

    res.status(201).json({ ncr: getNcrWithContent(id) });
  } catch (err) { next(err); }
});

// GET /api/ncrs/images/:imageId — stream one NCR photo
router.get('/images/:imageId', (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.imageId)) return next(new AppError('Invalid image id', 400, 'VALIDATION_ERROR'));
    const image = db.get('SELECT file_name, file_path, mime_type FROM ncr_images WHERE id = ?', [req.params.imageId]);
    if (!image) return next(new AppError('Image not found', 404, 'NOT_FOUND'));
    if (!isInsideUploads(image.file_path)) return next(new AppError('File path outside uploads root', 400, 'INVALID_PATH'));
    const resolved = path.resolve(image.file_path);
    if (!fs.existsSync(resolved)) return next(new AppError('File not found on disk', 404, 'FILE_NOT_FOUND'));

    res.setHeader('Content-Type', image.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    const stream = fs.createReadStream(resolved);
    stream.on('error', () => next(new AppError('Error reading file', 500, 'FILE_READ_ERROR')));
    stream.pipe(res);
  } catch (err) { next(err); }
});

// GET /api/ncrs/:id — NCR with its sections and photos
router.get('/:id', (req, res, next) => {
  try {
    const ncr = getNcrWithContent(req.params.id);
    if (!ncr) return next(new AppError('NCR not found', 404, 'NOT_FOUND'));
    res.json({ ncr });
  } catch (err) { next(err); }
});

// PATCH /api/ncrs/:id
router.patch('/:id', loadNcr, (req, res, next) => {
  try {
    const { id } = req.params;
    const fields = normalizeNcrFields(req.body);
    if (fields.description_of_defect !== undefined && !fields.description_of_defect) {
      return next(new AppError('description_of_defect is required', 400, 'VALIDATION_ERROR'));
    }

    const now = new Date().toISOString();
    const updates = [];
    const values = [];
    for (const [f, v] of Object.entries(fields)) {
      updates.push(`${f} = ?`); values.push(v);
    }
    if (fields.status === 'closed' && req.ncr.status !== 'closed') {
      updates.push('closed_at = ?'); values.push(now);
    } else if (fields.status && fields.status !== 'closed' && req.ncr.status === 'closed') {
      updates.push('closed_at = ?'); values.push(null);
    }
    if (updates.length > 0) {
      updates.push('updated_at = ?'); values.push(now, id);
      db.run(`UPDATE ncrs SET ${updates.join(', ')} WHERE id = ?`, values);
    }
    res.json({ ncr: getNcrWithContent(id) });
  } catch (err) { next(err); }
});

// PUT /api/ncrs/:id/content — save section layout, photo placement, captions
router.put('/:id/content', loadNcr, (req, res, next) => {
  try {
    const content = syncNcrContent(req.params.id, req.body);
    res.json(content);
  } catch (err) { next(err); }
});

// POST /api/ncrs/:id/images — upload one JPEG / PNG photo (field "file")
router.post('/:id/images', loadNcr, (req, res, next) => {
  if (imageCount(req.params.id) >= LIMITS.imagesPerNcr) {
    return next(new AppError(`An NCR can have at most ${LIMITS.imagesPerNcr} photos`, 400, 'VALIDATION_ERROR'));
  }
  next();
}, imageUpload.single('file'), (req, res, next) => {
  try {
    if (!req.file) return next(new AppError('No file provided', 400, 'VALIDATION_ERROR'));
    const mimeType = detectImageType(req.file.path);
    if (!mimeType) {
      removeImageFile(req.file.path);
      return next(new AppError('Only JPEG and PNG images are supported', 400, 'INVALID_FILE_TYPE'));
    }
    const caption = String(req.body.caption || '').trim();
    if (caption.length > LIMITS.captionLength) {
      removeImageFile(req.file.path);
      return next(new AppError(`Caption is too long (max ${LIMITS.captionLength} characters)`, 400, 'VALIDATION_ERROR'));
    }
    const image = addNcrImage(req.params.id, req.file, { caption, mimeType, user: req.user });
    res.status(201).json({ image });
  } catch (err) {
    if (req.file) removeImageFile(req.file.path);
    next(err);
  }
});

// GET /api/ncrs/:id/pdf — the finished NCR report
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const ncr = db.get(
      `SELECT n.*, i.form_no FROM ncrs n LEFT JOIN inspections i ON i.id = n.inspection_id WHERE n.id = ?`,
      [req.params.id]
    );
    if (!ncr) return next(new AppError('NCR not found', 404, 'NOT_FOUND'));
    const content = loadNcrContent(ncr.id, { withPaths: true });
    const pdfBuffer = await generateNcrPdf(ncr, content);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ncrPdfFilename(ncr)}"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

// DELETE /api/ncrs/:id — admin-level users only
router.delete('/:id', requireAdmin, loadNcr, (req, res, next) => {
  try {
    deleteNcr(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
