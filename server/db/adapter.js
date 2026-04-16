'use strict';
require('dotenv').config();

const adapter = (process.env.DB_ADAPTER || 'sqlite').toLowerCase();

let db;
if (adapter === 'sqlite') {
  db = require('./sqlite');
} else if (adapter === 'mssql') {
  // The MSSQL adapter is not implemented in this release. Fail fast with a
  // clear message rather than crashing with MODULE_NOT_FOUND mid-request.
  console.error('[DB] DB_ADAPTER=mssql is not implemented in this build. Set DB_ADAPTER=sqlite or implement server/db/mssql.js.');
  process.exit(1);
} else {
  console.error(`[DB] Unknown DB_ADAPTER "${adapter}". Expected "sqlite".`);
  process.exit(1);
}

module.exports = db;
