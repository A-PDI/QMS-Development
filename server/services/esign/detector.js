'use strict';
/**
 * Client for the Python field detector (esign-detector/app.py).
 *
 * Detection is a convenience: if the service is down, slow or disabled the
 * envelope is still created and the sender places fields by hand. Errors are
 * returned as { ok: false, note } rather than thrown.
 */

const config = require('./config');

const FIELD_TYPES = new Set([
  'signature', 'initials', 'date', 'name', 'title', 'company', 'email', 'text', 'checkbox',
]);

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Keep only well-formed fields from the detector's response. */
function sanitizeDetected(fields, pageCount) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f) => f && Number.isInteger(f.page) && f.page >= 0 && f.page < pageCount
      && finite(f.x) && finite(f.y) && finite(f.width) && finite(f.height)
      && f.width > 0 && f.height > 0 && FIELD_TYPES.has(f.type))
    .map((f) => ({
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      type: f.type,
      label: typeof f.label === 'string' ? f.label.slice(0, 200) : null,
      required: f.required !== false,
      source: ['ml', 'acroform', 'tag'].includes(f.source) ? f.source : 'ml',
      role_hint: typeof f.role_hint === 'string' ? f.role_hint.slice(0, 60) : null,
      recipient_index: Number.isInteger(f.recipient_index) ? f.recipient_index : null,
      confidence: finite(f.confidence) ? f.confidence : null,
    }));
}

async function detectFields(pdfBytes, pageCount) {
  if (!config.detectorEnabled()) {
    return { ok: false, status: 'skipped', note: 'Field detection is turned off (ESIGN_DETECTOR_ENABLED=false).', fields: [] };
  }
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'document.pdf');
  const headers = {};
  if (config.detectorKey()) headers['X-Api-Key'] = config.detectorKey();

  let res;
  try {
    res = await fetch(`${config.detectorUrl()}/detect`, {
      method: 'POST',
      body: form,
      headers,
      signal: AbortSignal.timeout(config.detectorTimeoutMs()),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      status: 'failed',
      note: timedOut
        ? 'Field detection timed out. Place the fields by hand, or try Detect again.'
        : `The field detector is not reachable at ${config.detectorUrl()}. Place the fields by hand.`,
      fields: [],
    };
  }

  let body = null;
  try { body = await res.json(); } catch (_) { /* non-JSON error page */ }
  if (!res.ok) {
    return {
      ok: false,
      status: 'failed',
      note: (body && body.error) ? `Field detection failed: ${body.error}` : `Field detection failed (HTTP ${res.status}).`,
      fields: [],
    };
  }
  const fields = sanitizeDetected(body && body.fields, pageCount);
  const counts = (body && body.counts) || {};
  let note = `Found ${fields.length} field${fields.length === 1 ? '' : 's'}`;
  if (body && body.ml_used === false && body.ml_error) note += ' (model unavailable — only form fields and tags were read)';
  note += '.';
  return { ok: true, status: 'done', note, fields, counts };
}

module.exports = { detectFields, sanitizeDetected, FIELD_TYPES };
