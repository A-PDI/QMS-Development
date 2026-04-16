'use strict';
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const upload = require('../middleware/upload');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

// GET /api/attachments/:inspectionId
router.get('/:inspectionId', (req, res, next) => {
  try {
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
    const attachment = db.get('SELECT * FROM inspection_attachments WHERE id = ?', [req.params.id]);
    if (!attachment) {
      return next(new AppError('Attachment not found', 404, 'NOT_FOUND'));
    }

    if (!fs.existsSync(attachment.file_path)) {
      return next(new AppError('File not found on disk', 404, 'FILE_NOT_FOUND'));
    }

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${attachment.file_name}"`);

    const stream = fs.createReadStream(attachment.file_path);
    stream.on('error', (err) => next(new AppError('Error reading file', 500, 'FILE_READ_ERROR')));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/attachments/:id
router.delete('/:id', (req, res, next) => {
  try {
    const attachment = db.get('SELECT * FROM inspection_attachments WHERE id = ?', [req.params.id]);
    if (!attachment) {
      return next(new AppError('Attachment not found', 404, 'NOT_FOUND'));
    }

    if (fs.existsSync(attachment.file_path)) {
      fs.unlinkSync(attachment.file_path);
    }

    db.run('DELETE FROM inspection_attachments WHERE id = ?', [req.params.id]);

    res.json({ message: 'Attachment deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
