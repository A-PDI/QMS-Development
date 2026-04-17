'use strict';
/**
 * Bootstrap the target SQLite database from a committed seed snapshot when
 * the persistent disk is empty. This is what lets a fresh Render deploy
 * come up populated with the inspection records you created locally
 * rather than an empty schema.
 *
 * Rules:
 *   1. Runs if the target DB file is missing OR exists but has zero
 *      inspections. The zero-inspections check matters because the first
 *      Render deploy (before the seed was committed) already created an
 *      empty inspection.db on the persistent disk with the schema in
 *      place — checking "does the file exist" alone would incorrectly
 *      skip the seed forever on that disk.
 *   2. Once real inspection records exist on the Render persistent disk,
 *      subsequent deploys are no-ops — we never overwrite live data.
 *   3. Copies server/db/seed/uploads/* into UPLOAD_DIR so attachments
 *      resolve on disk. Existing files in UPLOAD_DIR are preserved.
 *   4. Rewrites inspection_attachments.file_path rows to absolute paths
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

  if (!fs.existsSync(seedDb)) {
    return { ran: false, reason: 'no seed bundle committed' };
  }

  // Decide whether the target is "empty enough" to bootstrap over.
  const targetState = inspectTargetDb(dbPath);
  if (targetState.hasInspections) {
    console.log('[bootstrap] Target DB already has ' + targetState.count + ' inspection(s) — skipping seed');
    return { ran: false, reason: 'target already has inspections' };
  }

  if (targetState.exists) {
    console.log('[bootstrap] Target DB exists but is empty — replacing with seed');
    // Remove the empty target (and any stale sidecars) so the seed copy
    // isn't fighting a stale WAL/SHM from the empty DB.
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const p = dbPath + suffix;
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (err) {
        console.warn('[bootstrap] Could not remove ' + p + ': ' + err.message);
      }
    }
  } else {
    console.log('[bootstrap] Target DB missing — seeding from ' + seedDb);
  }

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
    console.log('[bootstrap] Uploads copied into ' + uploadRoot);
  }

  // Rewrite file_path values in the attachment table to the live layout.
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
    console.log('[bootstrap] Rewrote file_path for ' + rewritten + ' attachment(s)');
  } finally {
    if (seededDb) {
      try { seededDb.close(); } catch (_) {}
    }
  }

  return { ran: true };
}

/**
 * Open the target DB (read-only) and report whether it contains any
 * inspection records. Missing file / unreadable file are both treated as
 * "empty" so the bootstrap proceeds.
 */
function inspectTargetDb(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return { exists: false, hasInspections: false, count: 0 };
  }
  let probe;
  try {
    probe = new DatabaseSync(dbPath, { readOnly: true });
    // Make sure the inspections table exists before querying it — a
    // freshly-created empty file may not have gone through schema init.
    const tbl = probe
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inspections'")
      .get();
    if (!tbl) {
      return { exists: true, hasInspections: false, count: 0 };
    }
    const row = probe.prepare('SELECT COUNT(*) AS c FROM inspections').get();
    const count = row && row.c ? row.c : 0;
    return { exists: true, hasInspections: count > 0, count: count };
  } catch (err) {
    console.warn('[bootstrap] Could not inspect target DB (' + err.message + ') — treating as empty');
    return { exists: true, hasInspections: false, count: 0 };
  } finally {
    if (probe) {
      try { probe.close(); } catch (_) {}
    }
  }
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
 * Copy src to dst recursively. Existing files at dst are preserved
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
        console.warn('[bootstrap] Could not copy ' + s + ': ' + err.message);
      }
    }
  }
}

module.exports = { bootstrapFromSeed };
