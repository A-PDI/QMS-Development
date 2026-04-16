'use strict';
/**
 * Snapshot the local SQLite database + uploaded attachments into a seed
 * bundle that gets committed to the repo. On first boot of a fresh Render
 * deploy (when /var/pdi-data/inspection.db doesn't exist yet) the server
 * bootstraps from this seed so existing inspection records show up in
 * production instead of starting from an empty database.
 *
 * Usage (from the `server/` directory):
 *     npm run snapshot
 *
 * Re-run this whenever you want to push a fresh copy of local data. The
 * bootstrap only runs if the persistent disk on Render is empty, so
 * re-snapshotting will NOT overwrite records created in production.
 *
 * Implementation note: the script overwrites files in place rather than
 * removing the seed directory, because some dev filesystems (e.g. the
 * Claude sandbox virtiofs mount) disallow unlink on files that originate
 * from the host mount.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SOURCE_DB = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.join(SERVER_ROOT, 'data', 'inspection.db');
const SOURCE_UPLOADS = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(SERVER_ROOT, 'uploads');

const SEED_DIR = path.join(__dirname, 'seed');
const SEED_DB = path.join(SEED_DIR, 'inspection.db');
const SEED_UPLOADS = path.join(SEED_DIR, 'uploads');

function main() {
  if (!fs.existsSync(SOURCE_DB)) {
    console.error('[snapshot] Source database not found: ' + SOURCE_DB);
    process.exit(1);
  }

  fs.mkdirSync(SEED_DIR, { recursive: true });

  // Checkpoint the WAL so all committed data is in the main .db file,
  // then close the connection so the file is safe to copy.
  let src;
  try {
    src = new DatabaseSync(SOURCE_DB);
    src.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally {
    if (src) {
      try { src.close(); } catch (_) {}
    }
  }

  // Overwrite the seed db in place (copyFileSync replaces by default).
  fs.copyFileSync(SOURCE_DB, SEED_DB);

  // Best-effort clean of sidecar files that may linger from a previous run.
  // These are gitignored anyway, but removing them keeps the seed dir tidy.
  for (const sidecar of ['inspection.db-journal', 'inspection.db-wal', 'inspection.db-shm']) {
    const p = path.join(SEED_DIR, sidecar);
    try { fs.unlinkSync(p); } catch (_) {
      try { fs.writeFileSync(p, ''); } catch (__) {}
    }
  }

  const dbStats = fs.statSync(SEED_DB);
  console.log('[snapshot] Wrote ' + SEED_DB + ' (' + Math.round(dbStats.size / 1024) + ' KB)');

  // Copy uploads tree if present.
  if (fs.existsSync(SOURCE_UPLOADS)) {
    fs.mkdirSync(SEED_UPLOADS, { recursive: true });
    copyDirectoryOverwrite(SOURCE_UPLOADS, SEED_UPLOADS);
    console.log('[snapshot] Copied uploads from ' + SOURCE_UPLOADS + ' to ' + SEED_UPLOADS);
  } else {
    console.warn('[snapshot] Upload directory not found (skipping): ' + SOURCE_UPLOADS);
  }

  // Eyeball counts so the user can confirm the snapshot looks right.
  const seed = new DatabaseSync(SEED_DB);
  try {
    const tables = seed
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    console.log('[snapshot] Row counts:');
    for (const t of tables) {
      const row = seed.prepare('SELECT COUNT(*) AS c FROM "' + t.name + '"').get();
      console.log('  ' + t.name + ': ' + row.c);
    }
  } finally {
    try { seed.close(); } catch (_) {}
  }

  console.log('[snapshot] Done. Commit server/db/seed/ and push to deploy.');
}

/**
 * Recursively copy src to dst, overwriting existing files. Skips .gitkeep
 * and dotfiles. Does not remove orphaned files at the destination.
 */
function copyDirectoryOverwrite(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.gitkeep' || entry.name.startsWith('.')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryOverwrite(s, d);
    } else {
      try {
        fs.copyFileSync(s, d);
      } catch (err) {
        console.warn('[snapshot] Could not copy ' + s + ': ' + err.message);
      }
    }
  }
}

try {
  main();
} catch (err) {
  console.error('[snapshot] Failed:', err.message);
  console.error(err.stack);
  process.exit(1);
}
