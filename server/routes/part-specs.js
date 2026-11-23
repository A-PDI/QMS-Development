'use strict';
const express = require('express');
const router = express.Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');
const { loadRules, findPartSpec } = require('../services/dimensionalEvaluation');
const {
  familyKey, findFamilyCandidates, variantsOf, planPropagation, applyPlan,
} = require('../services/partFamilies');

const SPEC_ADMIN_ROLES = ['admin', 'qc_manager'];
const PRODUCT_FAMILY_MAX = 120;

/** Optional product family text: trimmed, '' → null, capped in length. */
function cleanProductFamily(value) {
  const text = String(value ?? '').trim().slice(0, PRODUCT_FAMILY_MAX);
  return text || null;
}

/**
 * Validate and clean spec_data with the shared dimensional rules. Throws a
 * 400 naming the first bad entry so an impossible range is never stored.
 */
async function cleanSpecData(specData) {
  const rules = await loadRules();
  const { data, errors } = rules.sanitizeSpecData(specData || {});
  if (errors.length) {
    const first = errors[0];
    throw new AppError(`Invalid specification${first.key ? ` for ${first.key}` : ''}: ${first.message}`, 400, 'VALIDATION_ERROR');
  }
  return data;
}

function parseJson(text, fallback) {
  if (text && typeof text === 'object') return text;
  try { return JSON.parse(text || ''); } catch (_) { return fallback; }
}

function serializeSpec(row) {
  if (!row) return row;
  return { ...row, spec_data: parseJson(row.spec_data, {}) };
}

// In-memory upload for spreadsheet parsing — the file is never persisted.
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// Resolve a free-text "product type" cell to a template id. Matches (case-
// insensitively) against form_no, component_type, or title so the spreadsheet
// can use whatever the admin is comfortable typing.
function resolveTemplateId(raw, templates) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  for (const t of templates) {
    if ((t.form_no || '').toLowerCase() === v) return t.id;
    if ((t.component_type || '').toLowerCase() === v) return t.id;
    if ((t.title || '').toLowerCase() === v) return t.id;
  }
  // Looser contains-match as a fallback (e.g. "Cylinder Head" vs full title).
  for (const t of templates) {
    const hay = `${t.form_no} ${t.component_type} ${t.title}`.toLowerCase();
    if (hay.includes(v)) return t.id;
  }
  return null;
}

// Upsert a single catalogue row by (template_id, part_number). Returns
// 'created' | 'updated'. Throws AppError on bad input.
// `productFamily` is only written when supplied (undefined leaves it alone).
function upsertPartSpec(templateId, partNumber, description, productFamily) {
  const pn = String(partNumber || '').trim();
  if (!pn) throw new AppError('Part number is required', 400);
  const now = new Date().toISOString();
  const family = productFamily === undefined ? undefined : cleanProductFamily(productFamily);
  const existing = db.get(
    'SELECT id FROM part_specs WHERE template_id = ? AND part_number = ?',
    [templateId, pn]
  );
  if (existing) {
    if (family === undefined) {
      db.run('UPDATE part_specs SET description = ?, updated_at = ? WHERE id = ?',
        [description || null, now, existing.id]);
    } else {
      db.run('UPDATE part_specs SET description = ?, product_family = ?, updated_at = ? WHERE id = ?',
        [description || null, family, now, existing.id]);
    }
    return 'updated';
  }
  db.run(
    `INSERT INTO part_specs (id, template_id, part_number, description, product_family, spec_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`,
    [uuidv4(), templateId, pn, description || null, family ?? null, now, now]
  );
  return 'created';
}

// GET /api/part-specs/lookup?q=&template_id=&limit=
// Returns part numbers for autocomplete. The curated part_specs catalogue is
// the SINGLE source of truth — inspection history is intentionally NOT merged
// in, so the New Inspection dropdown only ever offers parts that an admin has
// added to the catalogue (directly, by Excel import, or by seeding from
// existing inspections via /import-from-inspections).
router.get('/lookup', (req, res, next) => {
  try {
    const { q, template_id } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const like = q ? `%${String(q).trim()}%` : null;

    let psSql = `SELECT ps.part_number, ps.description, ps.template_id,
                        t.form_no, t.title AS template_title, t.component_type
                 FROM part_specs ps
                 JOIN inspection_templates t ON t.id = ps.template_id
                 WHERE ps.part_number IS NOT NULL AND ps.part_number <> ''`;
    const psParams = [];
    if (template_id) { psSql += ' AND ps.template_id = ?'; psParams.push(template_id); }
    if (like) { psSql += ' AND (ps.part_number LIKE ? OR ps.description LIKE ?)'; psParams.push(like, like); }
    psSql += ' ORDER BY ps.part_number ASC';
    const catalogue = db.all(psSql, psParams);

    const results = catalogue.slice(0, limit).map(row => ({
      part_number: row.part_number,
      description: row.description || '',
      template_id: row.template_id,
      form_no: row.form_no,
      template_title: row.template_title,
      component_type: row.component_type,
      source: 'catalogue',
    }));

    res.json({ results });
  } catch (err) { next(err); }
});

// GET /api/part-specs/resolve?template_id=&part_number=
// The part spec an inspection of this part number is evaluated against — the
// same lookup the server applies when the inspection is saved or completed
// (exact part number first, then case/whitespace-insensitive).
router.get('/resolve', (req, res, next) => {
  try {
    const { template_id, part_number } = req.query;
    if (!template_id) return next(new AppError('template_id is required', 400, 'VALIDATION_ERROR'));
    res.json({ spec: findPartSpec(template_id, part_number) });
  } catch (err) { next(err); }
});

// GET /api/part-specs?template_id=&part_number=
router.get('/', (req, res, next) => {
  try {
    const { template_id, part_number } = req.query;
    let sql = `SELECT ps.*, t.form_no, t.title as template_title, t.component_type
               FROM part_specs ps JOIN inspection_templates t ON t.id = ps.template_id WHERE 1=1`;
    const params = [];
    if (template_id) { sql += ' AND ps.template_id = ?'; params.push(template_id); }
    if (part_number) { sql += ' AND ps.part_number = ?'; params.push(part_number); }
    sql += ' ORDER BY ps.part_number ASC';
    const specs = db.all(sql, params);
    specs.forEach(s => { s.spec_data = JSON.parse(s.spec_data || '{}'); });
    res.json({ specs });
  } catch (err) { next(err); }
});

// POST /api/part-specs
router.post('/', async (req, res, next) => {
  try {
    if (!SPEC_ADMIN_ROLES.includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const { template_id, description, spec_data, product_family } = req.body;
    const part_number = String(req.body.part_number ?? '').trim();
    if (!template_id || !part_number) return next(new AppError('template_id and part_number are required', 400));

    const template = db.get('SELECT id FROM inspection_templates WHERE id = ?', [template_id]);
    if (!template) return next(new AppError('Template not found', 404));
    const cleanedSpecs = await cleanSpecData(spec_data);

    const id = uuidv4();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO part_specs (id, template_id, part_number, description, product_family, spec_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, template_id, part_number, description || null, cleanProductFamily(product_family),
        JSON.stringify(cleanedSpecs), now, now]
    );
    const spec = serializeSpec(db.get('SELECT * FROM part_specs WHERE id = ?', [id]));
    res.status(201).json({ spec });
  } catch (err) {
    if (/UNIQUE constraint/i.test(err?.message || '')) {
      return next(new AppError('That part number already exists for this product type', 409));
    }
    next(err);
  }
});

// PATCH /api/part-specs/:id
router.patch('/:id', async (req, res, next) => {
  try {
    if (!SPEC_ADMIN_ROLES.includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const existing = db.get('SELECT id FROM part_specs WHERE id = ?', [req.params.id]);
    if (!existing) return next(new AppError('Part spec not found', 404));

    const now = new Date().toISOString();
    const updates = [];
    const values = [];
    if (req.body.part_number !== undefined) {
      const pn = String(req.body.part_number ?? '').trim();
      if (!pn) return next(new AppError('Part number is required', 400));
      updates.push('part_number = ?'); values.push(pn);
    }
    if (req.body.description !== undefined) { updates.push('description = ?'); values.push(req.body.description); }
    if (req.body.product_family !== undefined) { updates.push('product_family = ?'); values.push(cleanProductFamily(req.body.product_family)); }
    if (req.body.spec_data !== undefined) {
      updates.push('spec_data = ?');
      values.push(JSON.stringify(await cleanSpecData(req.body.spec_data)));
    }
    if (req.body.template_id !== undefined) {
      // Allow re-assigning the product type (template) of an existing part.
      const tmpl = db.get('SELECT id FROM inspection_templates WHERE id = ?', [req.body.template_id]);
      if (!tmpl) return next(new AppError('Template not found', 404));
      updates.push('template_id = ?'); values.push(req.body.template_id);
    }
    if (updates.length === 0) return res.json({ spec: existing });
    updates.push('updated_at = ?'); values.push(now); values.push(req.params.id);
    db.run(`UPDATE part_specs SET ${updates.join(', ')} WHERE id = ?`, values);
    const spec = serializeSpec(db.get('SELECT * FROM part_specs WHERE id = ?', [req.params.id]));
    res.json({ spec });
  } catch (err) {
    if (/UNIQUE constraint/i.test(err?.message || '')) {
      return next(new AppError('That part number already exists for this product type', 409));
    }
    next(err);
  }
});

// POST /api/part-specs/import
// Bulk import part numbers from an uploaded Excel/CSV file. Expected columns
// (header row, case-insensitive): "Part Number", "Description", "Product Type".
// Product Type is matched to an inspection template by form_no / component_type
// / title. Rows are upserted by (template_id, part_number).
router.post('/import', xlsxUpload.single('file'), async (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    if (!req.file || !req.file.buffer) return next(new AppError('No file uploaded', 400));

    const templates = db.all('SELECT id, form_no, title, component_type FROM inspection_templates');
    if (templates.length === 0) return next(new AppError('No inspection forms exist yet — create one before importing parts', 400));

    // Parse the workbook (xlsx or csv) from the in-memory buffer.
    const wb = new ExcelJS.Workbook();
    const name = (req.file.originalname || '').toLowerCase();
    try {
      if (name.endsWith('.csv')) {
        const { Readable } = require('stream');
        await wb.csv.read(Readable.from(req.file.buffer));
      } else {
        await wb.xlsx.load(req.file.buffer);
      }
    } catch {
      return next(new AppError('Could not read the file — please upload a valid .xlsx or .csv', 400));
    }
    const ws = wb.worksheets[0];
    if (!ws) return next(new AppError('The file has no worksheets', 400));

    // Map header names → column indexes from the first non-empty row.
    let headerRowNum = 0;
    const colMap = {};
    ws.eachRow((row, rowNum) => {
      if (headerRowNum) return;
      const vals = (row.values || []).map(v => (v == null ? '' : String(v).trim().toLowerCase()));
      const findCol = (...aliases) => {
        for (let i = 1; i < vals.length; i++) {
          if (aliases.some(a => vals[i] === a)) return i;
        }
        return 0;
      };
      const pnCol = findCol('part number', 'part_number', 'part #', 'part#', 'part no', 'part no.');
      if (pnCol) {
        headerRowNum = rowNum;
        colMap.part_number = pnCol;
        colMap.description = findCol('description', 'desc', 'part description');
        colMap.product_type = findCol('product type', 'product_type', 'part type', 'type', 'component', 'form');
        colMap.product_family = findCol('product family', 'product_family', 'family');
      }
    });
    if (!headerRowNum) {
      return next(new AppError('Could not find a "Part Number" header column in the file', 400));
    }

    const cell = (row, idx) => (idx ? (row.getCell(idx).value ?? '') : '');
    const result = { created: 0, updated: 0, skipped: 0, errors: [] };

    ws.eachRow((row, rowNum) => {
      if (rowNum <= headerRowNum) return;
      const partNumber = String(cell(row, colMap.part_number) || '').trim();
      const description = String(cell(row, colMap.description) || '').trim();
      const productTypeRaw = String(cell(row, colMap.product_type) || '').trim();
      // Only a file with a Product Family column sets the family; without one,
      // re-importing leaves families that were set in the app alone.
      const productFamily = colMap.product_family ? String(cell(row, colMap.product_family) || '').trim() : undefined;
      if (!partNumber) return; // silently ignore blank rows

      const templateId = resolveTemplateId(productTypeRaw, templates);
      if (!templateId) {
        result.skipped++;
        result.errors.push(`Row ${rowNum}: unknown product type "${productTypeRaw || '(blank)'}" for part ${partNumber}`);
        return;
      }
      try {
        const outcome = upsertPartSpec(templateId, partNumber, description, productFamily);
        result[outcome]++;
      } catch (e) {
        result.skipped++;
        result.errors.push(`Row ${rowNum}: ${e.message || 'failed'}`);
      }
    });

    // Cap the error list so the response stays small.
    if (result.errors.length > 50) {
      const extra = result.errors.length - 50;
      result.errors = result.errors.slice(0, 50);
      result.errors.push(`…and ${extra} more`);
    }
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/part-specs/import-from-inspections
// One-time seeding helper: copies every distinct (template_id, part_number)
// found in the existing inspection records into the part_specs catalogue.
router.post('/import-from-inspections', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const rows = db.all(
      `SELECT i.template_id, i.part_number,
              (SELECT i2.description FROM inspections i2
               WHERE i2.template_id = i.template_id AND i2.part_number = i.part_number
               ORDER BY i2.created_at DESC LIMIT 1) AS description
       FROM inspections i
       WHERE i.part_number IS NOT NULL AND TRIM(i.part_number) <> ''
       GROUP BY i.template_id, i.part_number`
    );
    const result = { created: 0, updated: 0, skipped: 0 };
    for (const r of rows) {
      try {
        const outcome = upsertPartSpec(r.template_id, r.part_number, r.description);
        result[outcome]++;
      } catch { result.skipped++; }
    }
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/part-specs/:id
router.delete('/:id', (req, res, next) => {
  try {
    if (!['admin', 'qc_manager'].includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    db.run('DELETE FROM part_specs WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Product families: copy specifications to related part numbers ───────────

const MAX_TARGETS = 200;

/** A part_specs row with its form's component type and sections. */
function loadPartWithForm(id) {
  const row = db.get(
    `SELECT ps.*, t.component_type, t.form_no, t.title AS template_title, t.sections AS template_sections
     FROM part_specs ps JOIN inspection_templates t ON t.id = ps.template_id
     WHERE ps.id = ?`,
    [id]
  );
  if (!row) return null;
  return { ...row, spec_data: parseJson(row.spec_data, {}), template_sections: parseJson(row.template_sections, {}) };
}

/** The other part numbers in a part's family (same component type). */
function familyCandidates(source) {
  const parts = db.all(
    `SELECT ps.id, ps.part_number, ps.description, ps.product_family, ps.template_id, ps.spec_data,
            t.component_type, t.form_no, t.title AS template_title
     FROM part_specs ps JOIN inspection_templates t ON t.id = ps.template_id
     WHERE LOWER(TRIM(t.component_type)) = LOWER(TRIM(?))`,
    [source.component_type || '']
  );
  return findFamilyCandidates(source, parts).map(p => ({ ...p, spec_data: parseJson(p.spec_data, {}) }));
}

/**
 * Resolve a request's target ids against the source part's family. Every id
 * must be a family member — specs are never copied to an unrelated part.
 */
function resolveTargets(source, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('Select at least one part number', 400, 'VALIDATION_ERROR');
  }
  if (ids.length > MAX_TARGETS) throw new AppError(`At most ${MAX_TARGETS} part numbers at a time`, 400, 'VALIDATION_ERROR');
  const family = new Map(familyCandidates(source).map(p => [p.id, p]));
  const unique = [...new Set(ids.map(String))];
  const outside = unique.filter(id => !family.has(id));
  if (outside.length) {
    throw new AppError('One or more selected part numbers are not in this product family', 400, 'NOT_IN_FAMILY');
  }
  return unique.map(id => family.get(id));
}

/** Plans for copying the source's saved specs to the given targets. */
async function buildPlans(source, targets) {
  const rules = await loadRules();
  const sectionsByTemplate = new Map();
  const sectionsFor = (templateId) => {
    if (!sectionsByTemplate.has(templateId)) {
      const t = db.get('SELECT sections FROM inspection_templates WHERE id = ?', [templateId]);
      sectionsByTemplate.set(templateId, t ? parseJson(t.sections, {}) : {});
    }
    return sectionsByTemplate.get(templateId);
  };
  return planPropagation(rules, {
    sourceSections: source.template_sections,
    sourceSpecData: source.spec_data,
    targets: targets.map(part => ({ part, sections: sectionsFor(part.template_id) })),
  });
}

function withSavepoint(work) {
  const name = `part_specs_${uuidv4().replace(/-/g, '')}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = work();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      db.exec(`RELEASE SAVEPOINT ${name}`);
    } catch (_) { /* the original error wins */ }
    throw err;
  }
}

// GET /api/part-specs/:id/family
// The other part numbers in this part's product family. Nothing is selected or
// changed here — the administrator chooses which (if any) receive the specs.
router.get('/:id/family', (req, res, next) => {
  try {
    if (!SPEC_ADMIN_ROLES.includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const source = loadPartWithForm(req.params.id);
    if (!source) return next(new AppError('Part spec not found', 404, 'NOT_FOUND'));
    const key = familyKey(source);
    const candidates = familyCandidates(source).map(p => ({
      id: p.id,
      part_number: p.part_number,
      description: p.description || '',
      product_family: p.product_family || null,
      template_id: p.template_id,
      form_no: p.form_no,
      variant: variantsOf(p.description).join(', '),
      specified_points: Object.keys(p.spec_data || {}).length,
    }));
    res.json({
      part: {
        id: source.id, part_number: source.part_number, description: source.description || '',
        product_family: source.product_family || null, form_no: source.form_no, component_type: source.component_type,
      },
      family: key ? { name: key.name, explicit: key.explicit } : null,
      candidates,
    });
  } catch (err) { next(err); }
});

// POST /api/part-specs/:id/propagate/preview   { target_ids: [...] }
// What copying this part's saved specs to the selected parts would do: points
// to fill, conflicts with specs those parts already have, and points that
// cannot be mapped. Changes nothing.
router.post('/:id/propagate/preview', async (req, res, next) => {
  try {
    if (!SPEC_ADMIN_ROLES.includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const source = loadPartWithForm(req.params.id);
    if (!source) return next(new AppError('Part spec not found', 404, 'NOT_FOUND'));
    const targets = resolveTargets(source, req.body?.target_ids);
    res.json({ plans: await buildPlans(source, targets) });
  } catch (err) { next(err); }
});

// POST /api/part-specs/:id/propagate
//   { targets: [{ id, replace_conflicts: boolean }] }
// Copy this part's saved specs to the selected family members. A point the
// target has no spec for is filled; a point it already specifies differently
// is only replaced when replace_conflicts is true for that part; points the
// target's form cannot map are skipped and reported. All targets are written
// in one transaction. The specs are copied, not linked: later edits to either
// part change only that part.
router.post('/:id/propagate', async (req, res, next) => {
  try {
    if (!SPEC_ADMIN_ROLES.includes(req.user?.role)) return next(new AppError('Unauthorized', 403));
    const source = loadPartWithForm(req.params.id);
    if (!source) return next(new AppError('Part spec not found', 404, 'NOT_FOUND'));
    const requested = Array.isArray(req.body?.targets) ? req.body.targets : null;
    if (!requested) return next(new AppError('targets is required', 400, 'VALIDATION_ERROR'));
    const replaceById = new Map(requested.map(t => [String(t?.id), t?.replace_conflicts === true]));
    const targets = resolveTargets(source, requested.map(t => t?.id).filter(Boolean));
    const plans = await buildPlans(source, targets);
    const now = new Date().toISOString();

    const results = withSavepoint(() => plans.map((plan) => {
      const target = targets.find(t => t.id === plan.id);
      const replace = replaceById.get(plan.id) === true;
      const next = applyPlan(target.spec_data, plan, replace);
      const changed = plan.apply.length > 0 || (replace && plan.conflicts.length > 0);
      if (changed) {
        db.run('UPDATE part_specs SET spec_data = ?, updated_at = ? WHERE id = ?', [JSON.stringify(next), now, plan.id]);
      }
      return {
        id: plan.id,
        part_number: plan.part_number,
        applied: plan.apply.length,
        replaced: replace ? plan.conflicts.length : 0,
        kept_existing: replace ? [] : plan.conflicts.map(c => ({ key: c.key, label: c.label })),
        unchanged: plan.unchanged.length,
        skipped: plan.skipped,
      };
    }));
    res.json({ source_id: source.id, results });
  } catch (err) { next(err); }
});

module.exports = router;
