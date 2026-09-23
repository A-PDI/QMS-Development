'use strict';
/**
 * NCR report content: user-created sections (title + free text) and captioned
 * photos, plus the NCR field normalisation shared by create and update.
 *
 * Photos either belong to a section or, with section_id NULL, to the report's
 * general Photos block. The editor saves the whole layout in one call
 * (syncNcrContent) so section order, image placement and captions always land
 * together.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/adapter');
const { AppError } = require('../middleware/error');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
const NCR_UPLOAD_ROOT = path.join(UPLOAD_ROOT, 'ncrs');

const LIMITS = {
  sections: 50,
  imagesPerNcr: 100,
  titleLength: 200,
  bodyLength: 20000,
  captionLength: 500,
};

const NCR_STATUSES = ['open', 'in_progress', 'closed'];
const NCR_SEVERITIES = ['minor', 'major', 'critical'];
const NCR_DISPOSITIONS = ['pending', 'accepted_as_is', 'rework', 'return_to_supplier', 'scrap', 'use_as_is', 'other'];

// Columns returned to the browser. file_path stays server-side.
const IMAGE_COLUMNS = 'id, section_id, caption, sort_order, file_name, mime_type, file_size_bytes, uploaded_at';

function validationError(message) {
  return new AppError(message, 400, 'VALIDATION_ERROR');
}

/** Directory holding one NCR's photos. Rejects anything that is not a UUID. */
function ncrUploadDir(ncrId) {
  if (!UUID_RE.test(String(ncrId || ''))) throw validationError('Invalid NCR id');
  return path.join(NCR_UPLOAD_ROOT, ncrId);
}

/** True when `filePath` resolves inside the uploads root. */
function isInsideUploads(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  return resolved.startsWith(UPLOAD_ROOT + path.sep);
}

/** Remove a stored photo from disk; never touches anything outside uploads. */
function removeImageFile(filePath) {
  if (!filePath || !isInsideUploads(filePath)) return;
  try {
    fs.unlinkSync(path.resolve(filePath));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[ncrs] unlink failed:', err.message);
  }
}

/**
 * Detect JPEG / PNG from the file's magic bytes. These are the only formats
 * pdfkit can embed, so anything else would silently drop out of the PDF.
 */
function detectImageType(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(8);
    const read = fs.readSync(fd, head, 0, 8, 0);
    if (read >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (read === 8 && head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    return null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function withTransaction(work) {
  const savepoint = `ncr_${uuidv4().replace(/-/g, '')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = work();
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (err) {
    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (_) { /* original error wins */ }
    throw err;
  }
}

// ── NCR fields ───────────────────────────────────────────────────────────────

function optionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Normalise NCR field values from a request body. Only keys present in the
 * body are returned, so the result doubles as a PATCH field list.
 */
function normalizeNcrFields(body = {}) {
  const out = {};
  for (const key of ['part_number', 'supplier', 'po_number', 'corrective_action_due_date']) {
    const v = optionalText(body[key]);
    if (v !== undefined) out[key] = v;
  }
  if (body.description_of_defect !== undefined) {
    out.description_of_defect = String(body.description_of_defect ?? '').trim();
  }
  if (body.quantity_affected !== undefined) {
    const raw = body.quantity_affected;
    if (raw === null || String(raw).trim() === '') {
      out.quantity_affected = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw validationError('Quantity affected must be a whole number');
      out.quantity_affected = n;
    }
  }
  if (body.corrective_action_required !== undefined) {
    const v = body.corrective_action_required;
    out.corrective_action_required = (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;
  }
  const enums = [
    ['status', NCR_STATUSES],
    ['severity', NCR_SEVERITIES],
    ['ncr_disposition', NCR_DISPOSITIONS],
  ];
  for (const [key, allowed] of enums) {
    if (body[key] === undefined) continue;
    if (!allowed.includes(body[key])) throw validationError(`Invalid ${key.replace(/_/g, ' ')}`);
    out[key] = body[key];
  }
  return out;
}

// ── Content ──────────────────────────────────────────────────────────────────

/**
 * Sections (each with its photos) and the general photos for one NCR, in
 * report order. `withPaths` adds file_path for the PDF renderer.
 */
function loadNcrContent(ncrId, { withPaths = false } = {}) {
  const columns = withPaths ? `${IMAGE_COLUMNS}, file_path` : IMAGE_COLUMNS;
  const sections = db.all(
    `SELECT id, title, body, sort_order, created_at, updated_at FROM ncr_sections
      WHERE ncr_id = ? ORDER BY sort_order ASC, created_at ASC`,
    [ncrId]
  );
  const images = db.all(
    `SELECT ${columns} FROM ncr_images WHERE ncr_id = ? ORDER BY sort_order ASC, uploaded_at ASC`,
    [ncrId]
  );
  const bySection = new Map(sections.map((s) => [s.id, []]));
  const photos = [];
  for (const img of images) {
    const bucket = img.section_id && bySection.get(img.section_id);
    if (bucket) bucket.push(img); else photos.push(img);
  }
  return {
    sections: sections.map((s) => ({ ...s, images: bySection.get(s.id) })),
    photos,
  };
}

function readText(value, label, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw validationError(`${label} must be text`);
  if (value.length > max) throw validationError(`${label} is too long (max ${max} characters)`);
  return value;
}

function readImageRefs(list, label, claim) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw validationError(`${label} must be a list`);
  return list.map((entry, i) => {
    const id = entry && entry.id;
    claim(id);
    return { id, caption: readText(entry.caption, `${label} caption ${i + 1}`, LIMITS.captionLength).trim() };
  });
}

/**
 * Replace an NCR's section layout, photo placement and captions.
 *
 * payload = {
 *   sections: [{ id?, title, body, images: [{ id, caption }] }],
 *   photos:   [{ id, caption }],             // general Photos block
 *   removed_image_ids: [id],                 // photos the user deleted
 * }
 *
 * Sections missing from the payload are deleted. Photos are only deleted when
 * listed in removed_image_ids; any photo the payload does not mention (e.g.
 * uploaded meanwhile by someone else) is kept at the end of the Photos block.
 */
function syncNcrContent(ncrId, payload = {}) {
  const body = payload || {};
  const existingSections = new Set(
    db.all('SELECT id FROM ncr_sections WHERE ncr_id = ?', [ncrId]).map((r) => r.id)
  );
  const existingImages = new Map(
    db.all('SELECT id, file_path, section_id, sort_order FROM ncr_images WHERE ncr_id = ? ORDER BY sort_order ASC, uploaded_at ASC', [ncrId])
      .map((r) => [r.id, r])
  );

  const seenImages = new Set();
  const claimImage = (id) => {
    if (typeof id !== 'string' || !existingImages.has(id)) throw validationError('Unknown photo in NCR content');
    if (seenImages.has(id)) throw validationError('A photo can only appear once in the report');
    seenImages.add(id);
  };

  if (body.sections !== undefined && !Array.isArray(body.sections)) throw validationError('sections must be a list');
  const rawSections = body.sections || [];
  if (rawSections.length > LIMITS.sections) throw validationError(`An NCR can have at most ${LIMITS.sections} sections`);

  const seenSections = new Set();
  const sections = rawSections.map((s, i) => {
    if (!s || typeof s !== 'object') throw validationError(`Section ${i + 1} is invalid`);
    let id = null;
    if (s.id !== undefined && s.id !== null && s.id !== '') {
      if (!existingSections.has(s.id) || seenSections.has(s.id)) throw validationError(`Section ${i + 1} is invalid`);
      seenSections.add(s.id);
      id = s.id;
    }
    const title = readText(s.title, `Section ${i + 1} title`, LIMITS.titleLength).trim();
    if (!title) throw validationError(`Section ${i + 1} needs a title`);
    return {
      id,
      title,
      body: readText(s.body, `Section ${i + 1} text`, LIMITS.bodyLength),
      images: readImageRefs(s.images, `Section ${i + 1} photo`, claimImage),
    };
  });
  const photos = readImageRefs(body.photos, 'Photo', claimImage);

  if (body.removed_image_ids !== undefined && !Array.isArray(body.removed_image_ids)) {
    throw validationError('removed_image_ids must be a list');
  }
  const removed = (body.removed_image_ids || []).map((id) => { claimImage(id); return id; });

  const now = new Date().toISOString();
  const removedPaths = withTransaction(() => {
    const paths = [];
    for (const id of removed) {
      paths.push(existingImages.get(id).file_path);
      db.run('DELETE FROM ncr_images WHERE id = ?', [id]);
    }

    const keptSectionIds = [];
    sections.forEach((s, i) => {
      if (s.id) {
        db.run(
          'UPDATE ncr_sections SET title = ?, body = ?, sort_order = ?, updated_at = ? WHERE id = ?',
          [s.title, s.body, i, now, s.id]
        );
      } else {
        s.id = uuidv4();
        db.run(
          `INSERT INTO ncr_sections (id, ncr_id, title, body, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [s.id, ncrId, s.title, s.body, i, now, now]
        );
      }
      keptSectionIds.push(s.id);
    });
    for (const id of existingSections) {
      if (!keptSectionIds.includes(id)) db.run('DELETE FROM ncr_sections WHERE id = ?', [id]);
    }

    const place = db.prepare('UPDATE ncr_images SET section_id = ?, caption = ?, sort_order = ? WHERE id = ?');
    for (const s of sections) {
      s.images.forEach((img, j) => place.run(s.id, img.caption, j, img.id));
    }
    photos.forEach((img, k) => place.run(null, img.caption, k, img.id));

    // Photos this save did not mention stay in the report, after the rest.
    let next = photos.length;
    const park = db.prepare('UPDATE ncr_images SET section_id = NULL, sort_order = ? WHERE id = ?');
    for (const id of existingImages.keys()) {
      if (!seenImages.has(id)) park.run(next++, id);
    }

    db.run('UPDATE ncrs SET updated_at = ? WHERE id = ?', [now, ncrId]);
    return paths;
  });

  removedPaths.forEach(removeImageFile);
  return loadNcrContent(ncrId);
}

/** Number of photos already stored for an NCR. */
function imageCount(ncrId) {
  return db.get('SELECT COUNT(*) AS c FROM ncr_images WHERE ncr_id = ?', [ncrId]).c;
}

/** Record an uploaded photo at the end of the NCR's general Photos block. */
function addNcrImage(ncrId, file, { caption = '', mimeType, user } = {}) {
  const id = uuidv4();
  const next = db.get(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ncr_images WHERE ncr_id = ? AND section_id IS NULL',
    [ncrId]
  ).n;
  db.run(
    `INSERT INTO ncr_images (id, ncr_id, section_id, caption, sort_order, file_name, file_path, mime_type,
       file_size_bytes, uploaded_by, uploaded_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ncrId, caption, next, file.originalname || 'photo', file.path, mimeType,
      file.size || null, (user && user.id) || null, new Date().toISOString()]
  );
  return db.get(`SELECT ${IMAGE_COLUMNS} FROM ncr_images WHERE id = ?`, [id]);
}

/** Delete an NCR, its sections and photos (database rows and files). */
function deleteNcr(ncrId) {
  const files = db.all('SELECT file_path FROM ncr_images WHERE ncr_id = ?', [ncrId]).map((r) => r.file_path);
  db.run('DELETE FROM ncrs WHERE id = ?', [ncrId]);
  files.forEach(removeImageFile);
  try {
    fs.rmSync(ncrUploadDir(ncrId), { recursive: true, force: true });
  } catch (err) {
    console.warn('[ncrs] could not remove upload folder:', err.message);
  }
}

module.exports = {
  LIMITS,
  NCR_STATUSES,
  NCR_SEVERITIES,
  NCR_DISPOSITIONS,
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
};
