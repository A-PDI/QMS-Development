'use strict';
// Uses Node.js 22's built-in SQLite — no native compilation required.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.SQLITE_PATH || './data/inspection.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

let rawDb = null;

function getDb() {
  if (!rawDb) {
    try {
      rawDb = new DatabaseSync(dbPath);
      rawDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      initSchema();
    } catch (err) {
      console.error('[SQLite] Failed to open database:', err.message);
      throw err;
    }
  }
  return rawDb;
}

function initSchema() {
  const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'inspector',
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspection_templates (
  id TEXT PRIMARY KEY,
  component_type TEXT NOT NULL,
  form_no TEXT NOT NULL,
  revision TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  form_type TEXT NOT NULL,
  disposition_type TEXT NOT NULL,
  header_schema TEXT NOT NULL,
  sections TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES inspection_templates(id),
  component_type TEXT NOT NULL,
  form_no TEXT NOT NULL,
  part_number TEXT,
  supplier TEXT,
  po_number TEXT,
  description TEXT,
  date_received TEXT,
  inspector_name TEXT,
  lot_size TEXT,
  aql_level TEXT,
  sample_size TEXT,
  lot_serial_no TEXT,
  signature TEXT,
  disposition TEXT,
  disposition_notes TEXT,
  section_data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT REFERENCES users(id),
  submitted_by TEXT REFERENCES users(id),
  submitted_at TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspection_attachments (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  uploaded_by TEXT REFERENCES users(id),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspection_notes (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  note_type TEXT NOT NULL DEFAULT 'internal',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
  try {
    rawDb.exec(schema);
    console.log('[SQLite] Schema initialized');
  } catch (err) {
    console.error('[SQLite] Schema init error:', err.message);
  }
  migrateSchema();
}

function migrateSchema() {
  // Column additions (try/catch — safe if column already exists)
  const columnMigrations = [
    'ALTER TABLE inspection_attachments ADD COLUMN section_key TEXT',
    'ALTER TABLE inspection_attachments ADD COLUMN item_id TEXT',
    'ALTER TABLE inspections ADD COLUMN completed_at TEXT',
  ];
  for (const sql of columnMigrations) {
    try { rawDb.exec(sql); } catch (_) {}
  }

  // New tables (IF NOT EXISTS — always safe to run)
  const tableMigrations = [
    `CREATE TABLE IF NOT EXISTS inspection_activity_log (
      id TEXT PRIMARY KEY,
      inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      actor_name TEXT,
      actor_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_activity_log_created ON inspection_activity_log(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_log_inspection ON inspection_activity_log(inspection_id)`,
    `CREATE TABLE IF NOT EXISTS part_specs (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
      part_number TEXT NOT NULL,
      description TEXT,
      spec_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_part_specs_unique ON part_specs(template_id, part_number)`,
    `CREATE TABLE IF NOT EXISTS ncrs (
      id TEXT PRIMARY KEY,
      ncr_number TEXT UNIQUE NOT NULL,
      inspection_id TEXT REFERENCES inspections(id),
      part_number TEXT,
      supplier TEXT,
      po_number TEXT,
      description_of_defect TEXT NOT NULL,
      quantity_affected INTEGER,
      severity TEXT NOT NULL DEFAULT 'major',
      ncr_disposition TEXT NOT NULL DEFAULT 'pending',
      corrective_action_required INTEGER NOT NULL DEFAULT 0,
      corrective_action_due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_by_name TEXT,
      created_by TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ncrs_status ON ncrs(status)`,
  ];
  for (const sql of tableMigrations) {
    try { rawDb.exec(sql); } catch (_) {}
  }

  // Data migrations — idempotent status normalisation
  try {
    rawDb.exec(`UPDATE inspections
      SET status = 'complete',
          completed_at = COALESCE(reviewed_at, submitted_at, updated_at)
      WHERE status IN ('submitted', 'approved', 'rejected')`);
  } catch (_) {}
}

const db = {
  get(sql, params = []) {
    try {
      return getDb().prepare(sql).get(...params);
    } catch (err) {
      console.error('[SQLite get error]', err.message, sql);
      throw err;
    }
  },
  all(sql, params = []) {
    try {
      return getDb().prepare(sql).all(...params);
    } catch (err) {
      console.error('[SQLite all error]', err.message, sql);
      throw err;
    }
  },
  run(sql, params = []) {
    try {
      const result = getDb().prepare(sql).run(...params);
      return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
    } catch (err) {
      console.error('[SQLite run error]', err.message, sql);
      throw err;
    }
  },
  exec(sql) {
    try {
      return getDb().exec(sql);
    } catch (err) {
      console.error('[SQLite exec error]', err.message);
      throw err;
    }
  },
  transaction(fn) {
    const database = getDb();
    database.exec('BEGIN');
    try {
      const result = fn();
      database.exec('COMMIT');
      return result;
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  },
};

module.exports = db;
