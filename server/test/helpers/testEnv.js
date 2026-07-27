'use strict';
/**
 * Shared test bootstrap.
 *
 * MUST be required before anything that touches db/adapter: it points SQLite at
 * a throwaway database (seeded from the committed snapshot, so the inspection
 * templates exist) instead of the developer's working data.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qms-injector-test-'));
process.env.SQLITE_PATH = path.join(tmpDir, 'inspection.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';
// Never let a test reach the real test bench.
delete process.env.CARBONZAPP_API_KEY;

const db = require('../../db/adapter');

// The server applies these on startup (index.js); tests need the same schema.
require('../../db/migrations').applyMigrations(db);

/**
 * Text drawn on each page of a pdfkit document, one array per page content
 * stream. Enough to assert what a report shows without a PDF library.
 */
function extractPdfPages(buffer) {
  const raw = buffer.toString('latin1');
  const pages = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  while ((match = streamRe.exec(raw)) !== null) {
    let data = Buffer.from(match[1], 'latin1');
    try {
      data = zlib.inflateSync(data);
    } catch (_) {
      continue; // not a deflate stream (fonts, images…)
    }
    const content = data.toString('latin1');
    if (!content.includes('BT')) continue;
    const strings = [];
    const textRe = /BT([\s\S]*?)ET/g;
    let block;
    while ((block = textRe.exec(content)) !== null) {
      const hexes = block[1].match(/<([0-9a-fA-F]+)>/g) || [];
      const text = hexes
        .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
        .join('');
      if (text) strings.push(text);
    }
    if (strings.length) pages.push(strings);
  }
  return pages;
}

/** All text in the document, flattened. */
function extractPdfText(buffer) {
  return extractPdfPages(buffer).flat();
}

/** Remove every injector/inspection row so each test starts from a clean slate. */
function resetInjectorData() {
  db.run('DELETE FROM injector_test_reports', []);
  db.run("DELETE FROM app_settings WHERE key IN ('carbonzapp_last_sync', 'carbonzapp_api_key')", []);
  const ids = db.all("SELECT id FROM inspections WHERE inspector_name IN ('Injector Test Bench', 'Test User')", [])
    .map((r) => r.id);
  for (const id of ids) {
    try { db.run('DELETE FROM inspection_activity_log WHERE inspection_id = ?', [id]); } catch (_) {}
    db.run('DELETE FROM inspections WHERE id = ?', [id]);
  }
}

/** Count of inspections created from injector tests. */
function injectorInspectionCount() {
  const row = db.get(
    "SELECT COUNT(*) AS c FROM inspections WHERE form_no = 'PDI-IQI-012'", []
  );
  return row ? row.c : 0;
}

module.exports = { db, tmpDir, extractPdfPages, extractPdfText, resetInjectorData, injectorInspectionCount };
