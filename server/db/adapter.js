'use strict';
require('dotenv').config();

const adapter = process.env.DB_ADAPTER || 'sqlite';

let db;
if (adapter === 'mssql') {
  db = require('./mssql');
} else {
  db = require('./sqlite');
}

module.exports = db;
