'use strict';
/**
 * E-sign envelopes: the lifecycle from upload to sealed PDF.
 *
 *   draft ──send──▶ sent ──(everyone signs)──▶ completed
 *                     ├──(a signer declines)──▶ declined
 *                     ├──(sender voids)──────▶ voided
 *                     └──(past expires_at)───▶ expired
 *
 * A draft holds the uploaded PDF, its recipients and the fields each one
 * fills. Sending flattens any form fields into a working copy and e-mails the
 * first signers a unique link. Each signature is stamped onto the working copy
 * as it arrives (later signers see earlier signatures); when the last one
 * lands, a certificate of completion is appended and the file is sealed.
 *
 * Signing links are random 256-bit tokens; only their SHA-256 is stored.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db/adapter');
const config = require('./config');
const esignPdf = require('./pdf');
const mail = require('./mail');
const detector = require('./detector');

const ADMIN_ROLES = ['admin', 'qc_manager'];
const FIELD_TYPES = ['signature', 'initials', 'date', 'name', 'title', 'company', 'email', 'text', 'checkbox'];
const TEXT_TYPES = ['name', 'title', 'company', 'email', 'text'];
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const MAX_RECIPIENTS = 20;
const MAX_FIELDS = 500;
const MAX_IMAGE_BYTES = 600 * 1024;

class EsignError extends Error {
  constructor(message, statusCode = 400, code = 'VALIDATION_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // middleware/error.js renders these as JSON
  }
}

// ── Small helpers ────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

function envelopeDir(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new EsignError('Invalid envelope id', 400);
  return path.join(config.storageDir(), id);
}

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readFileOr404(file, what) {
  try {
    return fs.readFileSync(file);
  } catch (err) {
    throw new EsignError(`The ${what} file is missing on the server.`, 404, 'FILE_MISSING');
  }
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

// One signing action per envelope at a time: two signers finishing at the
// same moment must not both rewrite the working PDF.
const locks = new Map();
function withEnvelopeLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return run;
}

function audit(envelopeId, event, { recipientId = null, actor = null, detail = null, ip = null, userAgent = null } = {}) {
  db.run(
    `INSERT INTO esign_audit (id, envelope_id, recipient_id, event, actor, detail, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), envelopeId, recipientId, event, actor, detail ? JSON.stringify(detail) : null,
      ip, userAgent ? String(userAgent).slice(0, 300) : null, nowIso()]
  );
}

function requestMeta(req) {
  return {
    ip: (req && (req.ip || req.socket?.remoteAddress)) || null,
    userAgent: (req && req.get && req.get('user-agent')) || null,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

function getEnvelopeRow(id) {
  const env = db.get('SELECT * FROM esign_envelopes WHERE id = ?', [id]);
  if (!env) throw new EsignError('Envelope not found', 404, 'NOT_FOUND');
  return expireIfDue(env);
}

/** Flip a sent envelope to expired once its deadline passes. */
function expireIfDue(env) {
  if (env.status === 'sent' && env.expires_at && new Date(env.expires_at) < new Date()) {
    db.run("UPDATE esign_envelopes SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'sent'", [nowIso(), env.id]);
    audit(env.id, 'expired');
    return { ...env, status: 'expired' };
  }
  return env;
}

function recipientsOf(envelopeId) {
  return db.all('SELECT * FROM esign_recipients WHERE envelope_id = ? ORDER BY routing_order, color_index', [envelopeId]);
}

function fieldsOf(envelopeId) {
  return db.all('SELECT * FROM esign_fields WHERE envelope_id = ? ORDER BY page, sort_order', [envelopeId]);
}

function publicRecipient(r) {
  return {
    id: r.id, name: r.name, email: r.email, role_label: r.role_label,
    routing_order: r.routing_order, auth_method: r.auth_method, status: r.status,
    color_index: r.color_index, sent_at: r.sent_at, viewed_at: r.viewed_at,
    consented_at: r.consented_at, signed_at: r.signed_at, declined_at: r.declined_at,
    decline_reason: r.decline_reason, signature_method: r.signature_method,
    signer_ip: r.signer_ip,
  };
}

function publicField(f) {
  return {
    id: f.id, recipient_id: f.recipient_id, page: f.page, x: f.x, y: f.y,
    width: f.width, height: f.height, type: f.type, label: f.label,
    required: !!f.required, source: f.source, role_hint: f.role_hint,
    recipient_index: f.recipient_index, confidence: f.confidence,
    value: f.value, filled_at: f.filled_at,
  };
}

function publicEnvelope(env) {
  return {
    id: env.id, title: env.title, message: env.message, status: env.status,
    routing: env.routing, original_name: env.original_name,
    original_sha256: env.original_sha256, signed_sha256: env.signed_sha256,
    sealed: !!env.sealed, pages: parseJson(env.page_info, []),
    detection_status: env.detection_status, detection_note: env.detection_note,
    created_by: env.created_by, created_by_name: env.created_by_name, created_by_email: env.created_by_email,
    expires_at: env.expires_at, sent_at: env.sent_at, completed_at: env.completed_at,
    declined_at: env.declined_at, voided_at: env.voided_at, void_reason: env.void_reason,
    created_at: env.created_at, updated_at: env.updated_at,
  };
}

function isAdmin(user) {
  return !!user && ADMIN_ROLES.includes(user.role);
}

function canManage(user, env) {
  return isAdmin(user) || (user && env.created_by === user.id);
}

function assertCanManage(user, env) {
  if (!canManage(user, env)) throw new EsignError('You do not have access to this envelope', 403, 'FORBIDDEN');
}

function assertDraft(env) {
  if (env.status !== 'draft') throw new EsignError('Only a draft can be edited', 409, 'NOT_DRAFT');
}

function getEnvelopeDetail(user, id) {
  const env = getEnvelopeRow(id);
  assertCanManage(user, env);
  const audits = db.all('SELECT * FROM esign_audit WHERE envelope_id = ? ORDER BY created_at, rowid', [id]);
  return {
    envelope: publicEnvelope(env),
    recipients: recipientsOf(id).map(publicRecipient),
    fields: fieldsOf(id).map(publicField),
    audit: audits.map((a) => ({
      id: a.id, event: a.event, actor: a.actor, recipient_id: a.recipient_id,
      detail: parseJson(a.detail, null), ip: a.ip, created_at: a.created_at,
    })),
    can_manage: true,
  };
}

function listEnvelopes(user, { status, search, mine, page = 1, limit = 25 } = {}) {
  const where = [];
  const params = [];
  if (!isAdmin(user) || mine === 'true') { where.push('e.created_by = ?'); params.push(user.id); }
  if (status) { where.push('e.status = ?'); params.push(status); }
  if (search) {
    where.push('(e.title LIKE ? OR e.original_name LIKE ? OR EXISTS (SELECT 1 FROM esign_recipients r WHERE r.envelope_id = e.id AND (r.name LIKE ? OR r.email LIKE ?)))');
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;
  const total = db.get(`SELECT COUNT(*) AS c FROM esign_envelopes e ${whereSql}`, params).c;
  const rows = db.all(
    `SELECT e.*,
       (SELECT COUNT(*) FROM esign_recipients r WHERE r.envelope_id = e.id) AS recipient_count,
       (SELECT COUNT(*) FROM esign_recipients r WHERE r.envelope_id = e.id AND r.status = 'signed') AS signed_count
     FROM esign_envelopes e ${whereSql}
     ORDER BY e.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, lim, offset]
  );
  return {
    envelopes: rows.map((r) => ({ ...publicEnvelope(expireIfDue(r)), recipient_count: r.recipient_count, signed_count: r.signed_count })),
    total, page: Math.max(parseInt(page, 10) || 1, 1), limit: lim,
  };
}

// ── Draft: create, detect, edit ──────────────────────────────────────────────

async function createEnvelope({ buffer, originalName, title, message, routing, user }) {
  if (!buffer || buffer.length === 0) throw new EsignError('Choose a PDF to upload');
  if (buffer.length > config.maxPdfMb() * 1024 * 1024) {
    throw new EsignError(`The PDF is larger than ${config.maxPdfMb()} MB`, 413, 'FILE_TOO_LARGE');
  }
  if (!buffer.slice(0, 1024).toString('latin1').includes('%PDF')) throw new EsignError('The file is not a PDF', 400, 'BAD_PDF');

  let pages;
  try {
    pages = await esignPdf.inspectPdf(buffer);
  } catch (err) {
    if (err instanceof esignPdf.PdfError) throw new EsignError(err.message, 400, err.code);
    throw err;
  }
  if (pages.length > config.maxPages()) {
    throw new EsignError(`The PDF has ${pages.length} pages; the limit is ${config.maxPages()}.`, 413, 'TOO_MANY_PAGES');
  }

  const id = uuidv4();
  const dir = envelopeDir(id);
  const originalPath = path.join(dir, 'original.pdf');
  writeFileAtomic(originalPath, buffer);

  const cleanName = String(originalName || 'document.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 200);
  const cleanTitle = String(title || cleanName.replace(/\.pdf$/i, '')).trim().slice(0, 200) || 'Untitled document';
  const ts = nowIso();
  db.run(
    `INSERT INTO esign_envelopes (id, title, message, status, routing, original_name, original_path, original_sha256,
       page_info, detection_status, created_by, created_by_name, created_by_email, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    [id, cleanTitle, message ? String(message).slice(0, 2000) : null, routing === 'parallel' ? 'parallel' : 'sequential',
      cleanName, originalPath, esignPdf.sha256(buffer), JSON.stringify(pages),
      user.id, user.name || null, user.email || null, ts, ts]
  );
  audit(id, 'created', { actor: user.name || user.email, detail: { file: cleanName, pages: pages.length } });

  // Detection takes a few seconds; the editor polls detection_status.
  runDetection(id).catch((err) => console.error('[esign] Detection crashed:', err));
  return getEnvelopeRow(id);
}

/** Replace detected (non-manual) fields with a fresh detection pass. */
async function runDetection(id) {
  const env = getEnvelopeRow(id);
  db.run("UPDATE esign_envelopes SET detection_status = 'pending', detection_note = NULL WHERE id = ?", [id]);
  const pages = parseJson(env.page_info, []);
  const result = await detector.detectFields(readFileOr404(env.original_path, 'original'), pages.length);

  const current = db.get('SELECT status FROM esign_envelopes WHERE id = ?', [id]);
  if (!current) return; // deleted meanwhile
  if (current.status !== 'draft') {
    db.run('UPDATE esign_envelopes SET detection_status = ?, detection_note = ? WHERE id = ?',
      ['skipped', 'The envelope was sent before detection finished.', id]);
    return;
  }
  transaction(() => {
    if (result.ok) {
      db.run("DELETE FROM esign_fields WHERE envelope_id = ? AND source != 'manual'", [id]);
      const base = (db.get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM esign_fields WHERE envelope_id = ?', [id]).m || 0) + 1;
      result.fields.slice(0, MAX_FIELDS).forEach((f, i) => {
        db.run(
          `INSERT INTO esign_fields (id, envelope_id, recipient_id, page, x, y, width, height, type, label, required,
             source, role_hint, recipient_index, confidence, sort_order)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), id, f.page, f.x, f.y, f.width, f.height, f.type, f.label, f.required ? 1 : 0,
            f.source, f.role_hint, f.recipient_index, f.confidence, base + i]
        );
      });
    }
    db.run('UPDATE esign_envelopes SET detection_status = ?, detection_note = ?, updated_at = ? WHERE id = ?',
      [result.status, result.note, nowIso(), id]);
  });
}

function updateDraft(user, id, { title, message, routing }) {
  const env = getEnvelopeRow(id);
  assertCanManage(user, env);
  assertDraft(env);
  const sets = [];
  const vals = [];
  if (title !== undefined) {
    const t = String(title).trim();
    if (!t) throw new EsignError('Title is required');
    sets.push('title = ?'); vals.push(t.slice(0, 200));
  }
  if (message !== undefined) { sets.push('message = ?'); vals.push(message ? String(message).slice(0, 2000) : null); }
  if (routing !== undefined) {
    if (!['sequential', 'parallel'].includes(routing)) throw new EsignError('routing must be sequential or parallel');
    sets.push('routing = ?'); vals.push(routing);
  }
  if (sets.length) {
    sets.push('updated_at = ?'); vals.push(nowIso(), id);
    db.run(`UPDATE esign_envelopes SET ${sets.join(', ')} WHERE id = ?`, vals);
  }
  return getEnvelopeRow(id);
}

function setRecipients(user, id, list) {
  const env = getEnvelopeRow(id);
  assertCanManage(user, env);
  assertDraft(env);
  if (!Array.isArray(list)) throw new EsignError('recipients must be an array');
  if (list.length > MAX_RECIPIENTS) throw new EsignError(`At most ${MAX_RECIPIENTS} recipients`);

  const seen = new Set();
  const clean = list.map((r, i) => {
    const name = String(r?.name || '').trim();
    const email = normEmail(r?.email);
    if (!name) throw new EsignError(`Recipient ${i + 1}: name is required`);
    if (!EMAIL_RE.test(email)) throw new EsignError(`Recipient ${i + 1}: "${r?.email || ''}" is not a valid e-mail address`);
    if (seen.has(email)) throw new EsignError(`${email} is listed twice`);
    seen.add(email);
    const order = env.routing === 'parallel' ? 1 : parseInt(r?.routing_order, 10) || (i + 1);
    if (order < 1 || order > MAX_RECIPIENTS) throw new EsignError(`Recipient ${i + 1}: signing order must be 1–${MAX_RECIPIENTS}`);
    const auth = r?.auth_method === 'account' ? 'account' : 'link';
    return {
      id: typeof r?.id === 'string' ? r.id : null, name: name.slice(0, 120), email,
      role_label: r?.role_label ? String(r.role_label).trim().slice(0, 60) : null,
      routing_order: order, auth_method: auth, color_index: i,
    };
  });

  transaction(() => {
    const existing = new Set(recipientsOf(id).map((r) => r.id));
    const keep = new Set();
    for (const r of clean) {
      if (r.id && existing.has(r.id)) {
        db.run(
          `UPDATE esign_recipients SET name = ?, email = ?, role_label = ?, routing_order = ?, auth_method = ?, color_index = ?
           WHERE id = ? AND envelope_id = ?`,
          [r.name, r.email, r.role_label, r.routing_order, r.auth_method, r.color_index, r.id, id]
        );
        keep.add(r.id);
      } else {
        const rid = uuidv4();
        db.run(
          `INSERT INTO esign_recipients (id, envelope_id, name, email, role_label, routing_order, auth_method, color_index, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [rid, id, r.name, r.email, r.role_label, r.routing_order, r.auth_method, r.color_index, nowIso()]
        );
        keep.add(rid);
      }
    }
    for (const old of existing) {
      if (!keep.has(old)) {
        db.run('UPDATE esign_fields SET recipient_id = NULL WHERE recipient_id = ?', [old]);
        db.run('DELETE FROM esign_recipients WHERE id = ?', [old]);
      }
    }
    db.run('UPDATE esign_envelopes SET updated_at = ? WHERE id = ?', [nowIso(), id]);
  });
  // Same order as the request (color_index is the position), so the client
  // can map its temporary ids to the new ones by index.
  return recipientsOf(id).sort((a, b) => a.color_index - b.color_index).map(publicRecipient);
}

function validateField(f, i, pages, recipientIds) {
  const where = `Field ${i + 1}`;
  if (!f || typeof f !== 'object') throw new EsignError(`${where} is not an object`);
  if (!Number.isInteger(f.page) || f.page < 0 || f.page >= pages.length) throw new EsignError(`${where}: page is out of range`);
  for (const k of ['x', 'y', 'width', 'height']) {
    if (typeof f[k] !== 'number' || !Number.isFinite(f[k])) throw new EsignError(`${where}: ${k} must be a number`);
  }
  if (f.width < 4 || f.height < 4) throw new EsignError(`${where} is too small`);
  const p = pages[f.page];
  const [l, b, r, t] = p.crop || [0, 0, p.width, p.height];
  const slack = 2;
  if (f.x < l - slack || f.y < b - slack || f.x + f.width > r + slack || f.y + f.height > t + slack) {
    throw new EsignError(`${where} lies outside page ${f.page + 1}`);
  }
  if (!FIELD_TYPES.includes(f.type)) throw new EsignError(`${where}: unknown type "${f.type}"`);
  if (f.recipient_id != null && !recipientIds.has(f.recipient_id)) throw new EsignError(`${where}: unknown recipient`);
}

function setFields(user, id, list) {
  const env = getEnvelopeRow(id);
  assertCanManage(user, env);
  assertDraft(env);
  if (!Array.isArray(list)) throw new EsignError('fields must be an array');
  if (list.length > MAX_FIELDS) throw new EsignError(`At most ${MAX_FIELDS} fields`);
  const pages = parseJson(env.page_info, []);
  const recipientIds = new Set(recipientsOf(id).map((r) => r.id));
  list.forEach((f, i) => validateField(f, i, pages, recipientIds));

  transaction(() => {
    db.run('DELETE FROM esign_fields WHERE envelope_id = ?', [id]);
    list.forEach((f, i) => {
      db.run(
        `INSERT INTO esign_fields (id, envelope_id, recipient_id, page, x, y, width, height, type, label, required,
           source, role_hint, recipient_index, confidence, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), id, f.recipient_id || null, f.page, f.x, f.y, f.width, f.height, f.type,
          f.label ? String(f.label).slice(0, 200) : null, f.required === false ? 0 : 1,
          ['ml', 'acroform', 'tag'].includes(f.source) ? f.source : 'manual',
          f.role_hint ? String(f.role_hint).slice(0, 60) : null,
          Number.isInteger(f.recipient_index) ? f.recipient_index : null,
          typeof f.confidence === 'number' ? f.confidence : null, i]
      );
    });
    db.run('UPDATE esign_envelopes SET updated_at = ? WHERE id = ?', [nowIso(), id]);
  });
  return fieldsOf(id).map(publicField);
}

function deleteDraft(user, id) {
  const env = getEnvelopeRow(id);
  assertCanManage(user, env);
  if (!['draft', 'voided', 'expired', 'declined'].includes(env.status)) {
    throw new EsignError('Sent or completed envelopes are kept as records; void it instead', 409, 'NOT_DELETABLE');
  }
  db.run('DELETE FROM esign_envelopes WHERE id = ?', [id]);
  try { fs.rmSync(envelopeDir(id), { recursive: true, force: true }); } catch (err) {
    console.warn('[esign] Could not remove envelope files:', err.message);
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

function issueToken(recipientId, purpose = 'email') {
  const token = crypto.randomBytes(32).toString('base64url');
  db.run('INSERT INTO esign_tokens (id, recipient_id, token_hash, purpose, created_at) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), recipientId, hashToken(token), purpose, nowIso()]);
  return token;
}

function revokeTokens(recipientId, purposes = null) {
  if (purposes) {
    db.run(`UPDATE esign_tokens SET revoked_at = ? WHERE recipient_id = ? AND revoked_at IS NULL AND purpose IN (${purposes.map(() => '?').join(',')})`,
      [nowIso(), recipientId, ...purposes]);
  } else {
    db.run('UPDATE esign_tokens SET revoked_at = ? WHERE recipient_id = ? AND revoked_at IS NULL', [nowIso(), recipientId]);
  }
}

const signUrl = (token) => `${config.publicUrl()}/sign/${token}`;

/** Recipients whose turn it is (lowest routing order not yet signed). */
function activeRecipients(envelopeId) {
  const rows = recipientsOf(envelopeId).filter((r) => r.status !== 'signed');
  if (rows.length === 0) return [];
  const order = Math.min(...rows.map((r) => r.routing_order));
  return rows.filter((r) => r.routing_order === order);
}

async function inviteRecipients(env, recipients, { reminder = false, actor = null } = {}) {
  const links = [];
  for (const r of recipients) {
    if (reminder) revokeTokens(r.id, ['email']);
    const token = issueToken(r.id, 'email');
    const url = signUrl(token);
    try {
      const info = await mail.invitation({ envelope: env, recipient: r, url, senderName: env.created_by_name, isReminder: reminder });
      if (info.mode === 'json') links.push({ recipient_id: r.id, name: r.name, email: r.email, url });
      audit(env.id, reminder ? 'resent' : 'invited', { recipientId: r.id, actor, detail: { to: r.email, delivery: info.mode } });
    } catch (err) {
      console.error('[esign] Invitation e-mail failed:', err.message);
      audit(env.id, 'email_failed', { recipientId: r.id, detail: { to: r.email, error: err.message } });
      links.push({ recipient_id: r.id, name: r.name, email: r.email, url, error: 'E-mail failed — share this link directly' });
    }
    db.run("UPDATE esign_recipients SET status = CASE WHEN status = 'pending' THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, ?) WHERE id = ?",
      [nowIso(), r.id]);
  }
  return links;
}

async function sendEnvelope(user, id) {
  return withEnvelopeLock(id, async () => {
    const env = getEnvelopeRow(id);
    assertCanManage(user, env);
    assertDraft(env);
    const recipients = recipientsOf(id);
    const fields = fieldsOf(id);
    if (recipients.length === 0) throw new EsignError('Add at least one recipient');
    const unassigned = fields.filter((f) => !f.recipient_id);
    if (unassigned.length) {
      throw new EsignError(`${unassigned.length} field${unassigned.length === 1 ? ' is' : 's are'} not assigned to a recipient — assign or delete ${unassigned.length === 1 ? 'it' : 'them'}`, 400, 'UNASSIGNED_FIELDS');
    }
    for (const r of recipients) {
      if (!fields.some((f) => f.recipient_id === r.id && f.type === 'signature')) {
        throw new EsignError(`${r.name} has no signature field`, 400, 'MISSING_SIGNATURE');
      }
    }

    const working = await esignPdf.prepareWorkingCopy(readFileOr404(env.original_path, 'original'));
    const workingPath = path.join(envelopeDir(id), 'working.pdf');
    writeFileAtomic(workingPath, working);

    const ts = nowIso();
    const expires = new Date(Date.now() + config.expiryDays() * 864e5).toISOString();
    db.run(
      "UPDATE esign_envelopes SET status = 'sent', working_path = ?, sent_at = ?, expires_at = ?, updated_at = ? WHERE id = ?",
      [workingPath, ts, expires, ts, id]
    );
    audit(id, 'sent', { actor: user.name || user.email, detail: { recipients: recipients.length, fields: fields.length } });

    const sent = getEnvelopeRow(id);
    const links = await inviteRecipients(sent, activeRecipients(id), { actor: user.name || user.email });
    return { envelope: publicEnvelope(getEnvelopeRow(id)), links, mail_mode: mail.mailMode() };
  });
}

async function resendInvitations(user, id) {
  return withEnvelopeLock(id, async () => {
    const env = getEnvelopeRow(id);
    assertCanManage(user, env);
    if (env.status !== 'sent') throw new EsignError('Only an envelope that is out for signature can be re-sent', 409, 'NOT_SENT');
    const links = await inviteRecipients(env, activeRecipients(id), { reminder: true, actor: user.name || user.email });
    return { links, mail_mode: mail.mailMode() };
  });
}

async function voidEnvelope(user, id, reason) {
  return withEnvelopeLock(id, async () => {
    const env = getEnvelopeRow(id);
    assertCanManage(user, env);
    if (env.status !== 'sent') throw new EsignError('Only an envelope that is out for signature can be voided', 409, 'NOT_SENT');
    const why = String(reason || '').trim().slice(0, 1000);
    if (!why) throw new EsignError('Give a reason for voiding');
    const ts = nowIso();
    db.run("UPDATE esign_envelopes SET status = 'voided', voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?", [ts, why, ts, id]);
    audit(id, 'voided', { actor: user.name || user.email, detail: { reason: why } });
    for (const r of recipientsOf(id)) {
      revokeTokens(r.id);
      if (['sent', 'viewed'].includes(r.status)) {
        try { await mail.voided({ envelope: env, recipient: r, reason: why }); } catch (err) {
          audit(id, 'email_failed', { recipientId: r.id, detail: { to: r.email, error: err.message } });
        }
      }
    }
    return publicEnvelope(getEnvelopeRow(id));
  });
}

// ── Signer side (token links) ────────────────────────────────────────────────

/**
 * Resolve a signing link. Account-auth recipients must also be signed in to
 * the app as the same e-mail address (`user` from the optional JWT).
 */
function resolveToken(token, user) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{30,100}$/.test(token)) {
    throw new EsignError('This signing link is not valid.', 404, 'LINK_INVALID');
  }
  const row = db.get('SELECT * FROM esign_tokens WHERE token_hash = ?', [hashToken(token)]);
  if (!row) throw new EsignError('This signing link is not valid.', 404, 'LINK_INVALID');
  if (row.revoked_at) throw new EsignError('This signing link has been replaced. Use the most recent e-mail you received.', 410, 'LINK_REVOKED');
  const recipient = db.get('SELECT * FROM esign_recipients WHERE id = ?', [row.recipient_id]);
  if (!recipient) throw new EsignError('This signing link is not valid.', 404, 'LINK_INVALID');
  const envelope = getEnvelopeRow(recipient.envelope_id);

  if (recipient.auth_method === 'account') {
    if (!user) throw new EsignError('Sign in with your Microsoft account to open this document.', 401, 'LOGIN_REQUIRED');
    if (normEmail(user.email) !== normEmail(recipient.email)) {
      throw new EsignError(`This document is for ${recipient.email}. You are signed in as ${user.email}.`, 403, 'WRONG_ACCOUNT');
    }
  }
  return { tokenRow: row, recipient, envelope };
}

function signerState(envelope, recipient) {
  if (envelope.status === 'voided') return { can_sign: false, reason: 'This document was voided by the sender.' };
  if (envelope.status === 'expired') return { can_sign: false, reason: 'This signing request has expired.' };
  if (envelope.status === 'declined') return { can_sign: false, reason: 'Signing was declined, so this document is closed.' };
  if (envelope.status === 'completed') return { can_sign: false, reason: 'Everyone has signed. You can download the signed copy.' };
  if (envelope.status !== 'sent') return { can_sign: false, reason: 'This document is not out for signature.' };
  if (recipient.status === 'signed') return { can_sign: false, reason: 'You have already signed. You will receive the completed copy by e-mail.' };
  if (recipient.status === 'declined') return { can_sign: false, reason: 'You declined to sign this document.' };
  const active = activeRecipients(envelope.id).map((r) => r.id);
  if (!active.includes(recipient.id)) return { can_sign: false, reason: 'Another signer needs to sign first. You will get an e-mail when it is your turn.' };
  return { can_sign: true, reason: null };
}

function viewForSigner(ctx, req) {
  const { envelope, recipient } = ctx;
  const state = signerState(envelope, recipient);
  if (state.can_sign && !recipient.viewed_at) {
    const meta = requestMeta(req);
    db.run("UPDATE esign_recipients SET viewed_at = ?, status = 'viewed' WHERE id = ?", [nowIso(), recipient.id]);
    audit(envelope.id, 'viewed', { recipientId: recipient.id, actor: recipient.name, ...meta });
  }
  const fresh = db.get('SELECT * FROM esign_recipients WHERE id = ?', [recipient.id]);
  const downloadable = envelope.status === 'completed'
    && envelope.completed_at
    && Date.now() - new Date(envelope.completed_at).getTime() < config.downloadDays() * 864e5;
  return {
    envelope: {
      id: envelope.id, title: envelope.title, message: envelope.message, status: envelope.status,
      sender_name: envelope.created_by_name, sender_email: envelope.created_by_email,
      pages: parseJson(envelope.page_info, []), expires_at: envelope.expires_at,
    },
    recipient: {
      id: fresh.id, name: fresh.name, email: fresh.email, role_label: fresh.role_label,
      status: fresh.status, consented: !!fresh.consented_at, auth_method: fresh.auth_method,
    },
    fields: fieldsOf(envelope.id).filter((f) => f.recipient_id === recipient.id).map((f) => ({
      ...publicField(f),
      // Prefill what the system already knows; the signer can still edit text.
      value: f.value ?? (f.type === 'name' ? fresh.name : f.type === 'email' ? fresh.email : null),
    })),
    can_sign: state.can_sign,
    reason: state.reason,
    can_download: !!downloadable,
  };
}

function documentForSigner(ctx) {
  const { envelope } = ctx;
  if (envelope.status === 'completed' && envelope.signed_path) return readFileOr404(envelope.signed_path, 'signed');
  if (envelope.working_path) return readFileOr404(envelope.working_path, 'working');
  throw new EsignError('This document is not available.', 404, 'NOT_AVAILABLE');
}

function signedForSigner(ctx) {
  const view = viewForSigner(ctx, null);
  if (!view.can_download) throw new EsignError('The signed copy is not available.', 404, 'NOT_AVAILABLE');
  return { bytes: readFileOr404(ctx.envelope.signed_path, 'signed'), filename: mail.signedFilename(ctx.envelope) };
}

function recordConsent(ctx, req) {
  const { envelope, recipient } = ctx;
  const state = signerState(envelope, recipient);
  if (!state.can_sign) throw new EsignError(state.reason, 409, 'CANNOT_SIGN');
  if (!recipient.consented_at) {
    db.run('UPDATE esign_recipients SET consented_at = ? WHERE id = ?', [nowIso(), recipient.id]);
    audit(envelope.id, 'consented', { recipientId: recipient.id, actor: recipient.name, ...requestMeta(req) });
  }
  return { consented: true };
}

/** Decode and sanity-check a PNG data URL from the signature pad. */
function decodePng(dataUrl, what) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new EsignError(`The ${what} image is missing or not a PNG`);
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new EsignError(`The ${what} image is too large`);
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_MAGIC)) throw new EsignError(`The ${what} image is not a valid PNG`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (!w || !h || w > 4000 || h > 4000) throw new EsignError(`The ${what} image has an unusable size`);
  return buf;
}

function adoptMark(mark, what) {
  if (!mark || typeof mark !== 'object') return null;
  const method = mark.method === 'typed' ? 'typed' : mark.method === 'drawn' ? 'drawn' : null;
  if (!method) throw new EsignError(`Choose how to make your ${what}`);
  const text = method === 'typed' ? String(mark.text || '').trim().slice(0, 100) : null;
  if (method === 'typed' && !text) throw new EsignError(`Type your ${what}`);
  return { method, text, png: decodePng(mark.image, what) };
}

async function signAsRecipient(ctx, req, body) {
  return withEnvelopeLock(ctx.envelope.id, async () => {
    // Re-read inside the lock: state may have changed since the link resolved.
    const envelope = getEnvelopeRow(ctx.envelope.id);
    const recipient = db.get('SELECT * FROM esign_recipients WHERE id = ?', [ctx.recipient.id]);
    const state = signerState(envelope, recipient);
    if (!state.can_sign) throw new EsignError(state.reason, 409, 'CANNOT_SIGN');
    if (!recipient.consented_at) throw new EsignError('Agree to sign electronically first', 400, 'CONSENT_REQUIRED');

    const myFields = fieldsOf(envelope.id).filter((f) => f.recipient_id === recipient.id);
    const values = (body && typeof body.values === 'object' && body.values) || {};
    const needsSignature = myFields.some((f) => f.type === 'signature');
    const needsInitials = myFields.some((f) => f.type === 'initials');
    const signature = needsSignature ? adoptMark(body?.signature, 'signature') : null;
    const initials = needsInitials ? adoptMark(body?.initials, 'initials') : null;
    if (needsSignature && !signature) throw new EsignError('Add your signature', 400, 'SIGNATURE_REQUIRED');
    if (needsInitials && !initials) throw new EsignError('Add your initials', 400, 'INITIALS_REQUIRED');

    const ts = nowIso();
    const dateText = esignPdf.formatDateOnly(new Date(ts), config.timeZone());
    const filled = myFields.map((f) => {
      let value = null;
      if (f.type === 'signature' || f.type === 'initials') value = 'signed';
      else if (f.type === 'date') value = dateText;
      else if (f.type === 'checkbox') value = values[f.id] === true || values[f.id] === 'true' ? 'true' : 'false';
      else {
        const raw = values[f.id] ?? (f.type === 'name' ? recipient.name : f.type === 'email' ? recipient.email : '');
        value = String(raw ?? '').trim().slice(0, f.type === 'text' ? 500 : 200);
        if (f.type === 'email' && value && !EMAIL_RE.test(value)) throw new EsignError(`"${f.label || 'E-mail'}" is not a valid e-mail address`);
      }
      if (f.required && ((TEXT_TYPES.includes(f.type) && !value) || (f.type === 'checkbox' && value !== 'true'))) {
        throw new EsignError(`Complete the required field${f.label ? ` "${f.label}"` : ''} on page ${f.page + 1}`, 400, 'FIELD_REQUIRED');
      }
      return { ...f, value };
    });

    const dir = envelopeDir(envelope.id);
    const images = {};
    if (signature) {
      const p = path.join(dir, `signature-${recipient.id}.png`);
      writeFileAtomic(p, signature.png);
      images.signature = signature.png;
    }
    if (initials) {
      const p = path.join(dir, `initials-${recipient.id}.png`);
      writeFileAtomic(p, initials.png);
      images.initials = initials.png;
    }

    let stamped;
    try {
      stamped = await esignPdf.stampFields(readFileOr404(envelope.working_path, 'working'), filled, { [recipient.id]: images });
    } catch (err) {
      if (err instanceof esignPdf.PdfError) throw new EsignError(err.message, 400, err.code);
      throw err;
    }
    writeFileAtomic(envelope.working_path, stamped);

    const meta = requestMeta(req);
    transaction(() => {
      for (const f of filled) db.run('UPDATE esign_fields SET value = ?, filled_at = ? WHERE id = ?', [f.value, ts, f.id]);
      db.run(
        `UPDATE esign_recipients SET status = 'signed', signed_at = ?, signer_ip = ?, signer_user_agent = ?,
           signature_method = ?, signature_text = ?, signature_path = ?,
           initials_method = ?, initials_text = ?, initials_path = ?
         WHERE id = ?`,
        [ts, meta.ip, meta.userAgent ? String(meta.userAgent).slice(0, 300) : null,
          signature?.method || null, signature?.text || null, signature ? path.join(dir, `signature-${recipient.id}.png`) : null,
          initials?.method || null, initials?.text || null, initials ? path.join(dir, `initials-${recipient.id}.png`) : null,
          recipient.id]
      );
      db.run('UPDATE esign_envelopes SET updated_at = ? WHERE id = ?', [ts, envelope.id]);
    });
    audit(envelope.id, 'signed', {
      recipientId: recipient.id, actor: recipient.name, ...meta,
      detail: { method: signature?.method || null, typed: signature?.text || null, fields: filled.length },
    });

    return advance(envelope.id);
  });
}

/** After a signature: finish the envelope, or invite the next signers. */
async function advance(envelopeId) {
  const remaining = recipientsOf(envelopeId).filter((r) => r.status !== 'signed');
  if (remaining.length === 0) {
    try {
      await finalize(envelopeId);
    } catch (err) {
      console.error('[esign] Finalizing failed:', err);
      audit(envelopeId, 'finalize_failed', { detail: { error: err.message } });
      return { completed: false, finalize_error: true };
    }
    return { completed: true };
  }
  const env = getEnvelopeRow(envelopeId);
  const next = activeRecipients(envelopeId).filter((r) => r.status === 'pending');
  if (next.length) await inviteRecipients(env, next);
  return { completed: false };
}

function auditSummary(a) {
  const d = parseJson(a.detail, null) || {};
  if (a.event === 'signed') return d.method === 'typed' ? `typed "${d.typed}"` : d.method === 'drawn' ? 'drawn signature' : '';
  if (a.event === 'invited' || a.event === 'resent') return d.to ? `to ${d.to}` : '';
  if (a.event === 'declined' || a.event === 'voided') return d.reason || '';
  if (a.event === 'email_failed') return d.to ? `to ${d.to}` : '';
  return '';
}

async function finalize(envelopeId) {
  const env = getEnvelopeRow(envelopeId);
  if (env.status !== 'sent') throw new EsignError('The envelope is not out for signature', 409, 'NOT_SENT');
  const recipients = recipientsOf(envelopeId);
  const completedAt = nowIso();
  const audits = db.all('SELECT * FROM esign_audit WHERE envelope_id = ? ORDER BY created_at, rowid', [envelopeId])
    .filter((a) => !['finalize_failed'].includes(a.event))
    .concat([{ event: 'completed', created_at: completedAt, actor: null, ip: null, detail: null }]);

  const certificate = {
    envelopeId: env.id,
    title: env.title,
    originalName: env.original_name,
    originalSha256: env.original_sha256,
    pageCount: parseJson(env.page_info, []).length,
    senderName: env.created_by_name,
    senderEmail: env.created_by_email,
    sentAt: env.sent_at,
    completedAt,
    routing: env.routing,
    recipients: recipients.map((r) => ({
      ...r,
      signatureImage: r.signature_path && fs.existsSync(r.signature_path) ? fs.readFileSync(r.signature_path) : null,
    })),
    audit: audits.map((a) => ({ event: a.event, actor: a.actor, ip: a.ip, created_at: a.created_at, summary: auditSummary(a) })),
  };

  const { bytes, sealed } = await esignPdf.finalizeDocument(readFileOr404(env.working_path, 'working'), certificate);
  const signedPath = path.join(envelopeDir(envelopeId), 'signed.pdf');
  writeFileAtomic(signedPath, bytes);
  const signedSha = esignPdf.sha256(bytes);
  db.run(
    "UPDATE esign_envelopes SET status = 'completed', signed_path = ?, signed_sha256 = ?, sealed = ?, completed_at = ?, updated_at = ? WHERE id = ?",
    [signedPath, signedSha, sealed ? 1 : 0, completedAt, completedAt, envelopeId]
  );
  audit(envelopeId, 'completed', { detail: { signed_sha256: signedSha } });
  audit(envelopeId, sealed ? 'sealed' : 'not_sealed', {
    detail: sealed ? { name: config.sealName() } : { note: 'No sealing certificate configured (ESIGN_P12_PATH)' },
  });

  const done = getEnvelopeRow(envelopeId);
  const notify = [];
  for (const r of recipients) {
    const token = issueToken(r.id, 'download');
    notify.push({ to: `"${r.name.replace(/"/g, '')}" <${r.email}>`, name: r.name, url: signUrl(token), recipientId: r.id });
  }
  if (env.created_by_email && !recipients.some((r) => normEmail(r.email) === normEmail(env.created_by_email))) {
    notify.push({ to: env.created_by_email, name: env.created_by_name, url: `${config.publicUrl()}/esign/${envelopeId}` });
  }
  for (const n of notify) {
    try {
      await mail.completed({ envelope: done, to: n.to, name: n.name, pdf: bytes, downloadUrl: n.url });
    } catch (err) {
      audit(envelopeId, 'email_failed', { recipientId: n.recipientId || null, detail: { to: n.to, error: err.message } });
    }
  }
  return done;
}

/** Retry finalizing an envelope whose signers are all done (e.g. after fixing the seal certificate). */
async function retryFinalize(user, id) {
  return withEnvelopeLock(id, async () => {
    const env = getEnvelopeRow(id);
    assertCanManage(user, env);
    if (env.status !== 'sent') throw new EsignError('Nothing to finalize', 409, 'NOT_SENT');
    if (recipientsOf(id).some((r) => r.status !== 'signed')) throw new EsignError('Not everyone has signed yet', 409, 'NOT_READY');
    await finalize(id);
    return publicEnvelope(getEnvelopeRow(id));
  });
}

async function declineAsRecipient(ctx, req, reason) {
  return withEnvelopeLock(ctx.envelope.id, async () => {
    const envelope = getEnvelopeRow(ctx.envelope.id);
    const recipient = db.get('SELECT * FROM esign_recipients WHERE id = ?', [ctx.recipient.id]);
    const state = signerState(envelope, recipient);
    if (!state.can_sign) throw new EsignError(state.reason, 409, 'CANNOT_SIGN');
    const why = String(reason || '').trim().slice(0, 1000);
    if (!why) throw new EsignError('Tell the sender why you are declining');
    const ts = nowIso();
    transaction(() => {
      db.run("UPDATE esign_recipients SET status = 'declined', declined_at = ?, decline_reason = ? WHERE id = ?", [ts, why, recipient.id]);
      db.run("UPDATE esign_envelopes SET status = 'declined', declined_at = ?, updated_at = ? WHERE id = ?", [ts, ts, envelope.id]);
    });
    audit(envelope.id, 'declined', { recipientId: recipient.id, actor: recipient.name, detail: { reason: why }, ...requestMeta(req) });
    for (const r of recipientsOf(envelope.id)) revokeTokens(r.id, ['email', 'session']);
    if (envelope.created_by_email) {
      try { await mail.declined({ envelope, to: envelope.created_by_email, recipient, reason: why }); } catch (err) {
        audit(envelope.id, 'email_failed', { detail: { to: envelope.created_by_email, error: err.message } });
      }
    }
    return { declined: true };
  });
}

// ── In-app inbox for PDI staff ───────────────────────────────────────────────

function inbox(user) {
  const rows = db.all(
    `SELECT r.*, e.title, e.created_by_name, e.sent_at AS envelope_sent_at, e.expires_at, e.status AS envelope_status
     FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
     WHERE r.email = ? COLLATE NOCASE AND e.status = 'sent' AND r.status IN ('sent', 'viewed')
     ORDER BY e.sent_at DESC`,
    [normEmail(user.email)]
  );
  return rows.filter((r) => activeRecipients(r.envelope_id).some((a) => a.id === r.id)).map((r) => ({
    recipient_id: r.id, envelope_id: r.envelope_id, title: r.title, sender_name: r.created_by_name,
    sent_at: r.envelope_sent_at, expires_at: r.expires_at, status: r.status,
  }));
}

/** A fresh signing link for a staff member signing from inside the app. */
function startInboxSigning(user, recipientId) {
  const r = db.get('SELECT * FROM esign_recipients WHERE id = ?', [recipientId]);
  if (!r || normEmail(r.email) !== normEmail(user.email)) throw new EsignError('Not found', 404, 'NOT_FOUND');
  const env = getEnvelopeRow(r.envelope_id);
  const state = signerState(env, r);
  if (!state.can_sign) throw new EsignError(state.reason, 409, 'CANNOT_SIGN');
  revokeTokens(r.id, ['session']);
  const token = issueToken(r.id, 'session');
  return { path: `/sign/${token}` };
}

// ── Files for the sender ─────────────────────────────────────────────────────

function fileForManager(user, id, kind) {
  const env = getEnvelopeRow(id);
  assertCanManage(user, env);
  if (kind === 'original') return { bytes: readFileOr404(env.original_path, 'original'), filename: env.original_name };
  if (kind === 'signed') {
    if (!env.signed_path) throw new EsignError('The signed copy is not ready yet', 404, 'NOT_AVAILABLE');
    return { bytes: readFileOr404(env.signed_path, 'signed'), filename: mail.signedFilename(env) };
  }
  if (kind === 'current') {
    const p = env.signed_path || env.working_path || env.original_path;
    return { bytes: readFileOr404(p, 'document'), filename: env.original_name };
  }
  throw new EsignError('Unknown file', 400);
}

module.exports = {
  EsignError,
  ADMIN_ROLES,
  FIELD_TYPES,
  listEnvelopes,
  getEnvelopeDetail,
  createEnvelope,
  runDetection,
  updateDraft,
  setRecipients,
  setFields,
  deleteDraft,
  sendEnvelope,
  resendInvitations,
  voidEnvelope,
  retryFinalize,
  resolveToken,
  viewForSigner,
  documentForSigner,
  signedForSigner,
  recordConsent,
  signAsRecipient,
  declineAsRecipient,
  inbox,
  startInboxSigning,
  fileForManager,
  // for tests
  _internal: { hashToken, activeRecipients, decodePng, getEnvelopeRow, withEnvelopeLock },
};
