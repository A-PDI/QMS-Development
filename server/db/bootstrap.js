'use strict';
/**
 * Bootstrap the target SQLite database from a committed seed snapshot on
 * first boot. This is what lets a fresh Render deploy come up populated
 * with the inspection records you created locally rather than an empty
 * schema.
 *
 * Rules:
 *   1. Only runs if the target SQLITE_PATH file does NOT yet exist.
 *      Once real production data exists on the Render persistent disk,
 *      subsequent deploys are no-ops — we never overwrite live data.
 *   2. Copies server/db/seed/uploads/* into UPLOAD_DIR so attachments
 *      resolve on disk.
 *   3. Rewrites inspection_attachments.file_path rows to absolute paths
 *      rooted at the current UPLOAD_DIR. The seed stores paths as they
 *      were on the local dev machine (Windows-style backslashes, relative
 *      to the old server root) and that won't resolve on Linux.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

function bootstrapFromSeed(dbPath) {
  const seedDir = path.join(__dirname, 'seed');
  const seedDb = path.join(seedDir, 'inspection.db');
  const seedUploads = path.join(seedDir, 'uploads');

  if (fs.existsSync(dbPath)) {
    return { ran: false, reason: 'target database already exists' };
  }
  if (!fs.existsSync(seedDb)) {
    return { ran: false, reason: 'no seed bundle committed' };
  }

  console.log(`[bootstrap] Target DB missing — seeding from ${seedDb}`);

  // Make sure the target directory exists (Render persistent disk root).
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // Copy the snapshot into place BEFORE any DatabaseSync opens dbPath,
  // otherwise Node would create a fresh empty DB and we'd overwrite the
  // seed on next write.
  fs.copyFileSync(seedDb, dbPath);

  // Resolve current upload root (same logic as middleware/upload.js).
  const uploadRoot = path.resolve(
    process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')
  );

  // Copy uploaded files into the live UPLOAD_DIR so attachment downloads
  // can find them. Never clobber an existing file — if UPLOAD_DIR already
  // has real data for some reason, keep it.
  if (fs.existsSync(seedUploads)) {
    fs.mkdirSync(uploadRoot, { recursive: true });
    copyDirectoryPreserveExisting(seedUploads, uploadRoot);
    console.log(`[bootstrap] Uploads copied into ${uploadRoot}`);
  }

  // Rewrite file_path values in the attachment table.
  let seededDb;
  try {
    seededDb = new DatabaseSync(dbPath);
    const rows = seededDb
      .prepare('SELECT id, inspection_id, file_path FROM inspection_attachments')
      .all();
    const update = seededDb.prepare(
      'UPDATE inspection_attachments SET file_path = ? WHERE id = ?'
    );
    let rewritten = 0;
    for (const row of rows) {
      const basename = lastPathSegment(row.file_path || '');
      if (!row.inspection_id || !basename) continue;
      const newPath = path.join(uploadRoot, row.inspection_id, basename);
      update.run(newPath, row.id);
      rewritten++;
    }
    console.log(`[bootstrap] Rewrote file_path for ${rewritten} attachment(s)`);
  } finally {
    if (seededDb) {
      try { seededDb.close(); } catch (_) {}
    }
  }

  return { ran: true };
}

/**
 * Return just the final filename segment, handling both `\` and `/`.
 */
function lastPathSegment(value) {
  if (!value) return '';
  const parts = String(value).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * Copy src → dst recursively. Existing files at dst are preserved
 * (we don't overwrite — the persistent disk wins).
 */
function copyDirectoryPreserveExisting(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.gitkeep' || entry.name.startsWith('.')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryPreserveExisting(s, d);
    } else if (!fs.existsSync(d)) {
      try {
        fs.copyFileSync(s, d);
      } catch (err) {
        console.warn(`[bootstrap] Could not copy ${s}: ${err.message}`);
      }
    }
  }
}

module.exports = { bootstrapFromSeed };
