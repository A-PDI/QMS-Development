'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

// GET /api/templates
router.get('/', (req, res, next) => {
  try {
    const templates = db.all(
      'SELECT id, component_type, form_no, title, form_type, disposition_type FROM inspection_templates WHERE active = 1 ORDER BY form_no ASC',
      []
    );
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

// GET /api/templates/:id
router.get('/:id', (req, res, next) => {
  try {
    const template = db.get(
      'SELECT * FROM inspection_templates WHERE id = ?',
      [req.params.id]
    );
    if (!template) {
      return next(new AppError('Template not found', 404, 'NOT_FOUND'));
    }
    template.header_schema = JSON.parse(template.header_schema || '[]');
    template.sections = JSON.parse(template.sections || '{}');
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
