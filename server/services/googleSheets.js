'use strict';
/**
 * Appending rows to a Google Sheet as a service account.
 *
 * Setup, once:
 *   1. Google Cloud console → create a project → enable the Google Sheets API.
 *   2. Create a service account and download its JSON key.
 *   3. Share the target spreadsheet with the service account's email address
 *      (the client_email in that JSON) and give it Editor access — a service
 *      account has no access to a sheet until it is shared with it, exactly
 *      like a person.
 *   4. Put the key and the spreadsheet id in the server environment (see
 *      .env.example): either GOOGLE_SERVICE_ACCOUNT_KEY_FILE pointing at the
 *      JSON, or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.
 *
 * Only the two calls this app needs are wrapped: read the first row to see
 * whether the sheet has a header yet, and append rows below whatever is there.
 */

const fs = require('fs');
const crypto = require('crypto');
const { auth, sheets } = require('@googleapis/sheets');

// Write access to the spreadsheets the account has been given, and nothing else.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Values are sent the way a person typing them would be interpreted, so a
// "2026-06-30" lands in the sheet as a date that sorts and filters as one.
const VALUE_INPUT_OPTION = 'USER_ENTERED';
// Append below the existing rows instead of writing over anything that follows.
const INSERT_DATA_OPTION = 'INSERT_ROWS';

const DEFAULT_RANGE = 'Sheet1!A:C';

/** A private key pasted into .env keeps its newlines as a literal \n. */
function normalisePrivateKey(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
}

/**
 * The service account credentials, from a key file if one is configured and
 * from the two plain variables otherwise. Returns null when neither is set.
 */
function credentials() {
  const keyFile = String(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || '').trim();
  if (keyFile) {
    const parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(`${keyFile} is not a service account key (no client_email / private_key).`);
    }
    return { clientEmail: parsed.client_email, privateKey: normalisePrivateKey(parsed.private_key) };
  }

  const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = normalisePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!clientEmail || !privateKey) return null;
  return { clientEmail, privateKey };
}

/** Spreadsheet id and A1 range the daily export writes to. */
function target() {
  return {
    spreadsheetId: String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim(),
    range: String(process.env.GOOGLE_SHEETS_RANGE || '').trim() || DEFAULT_RANGE,
  };
}

/**
 * A private key that is present but cannot be loaded is worse than one that is
 * absent: everything looks configured and every nightly run dies at the token
 * exchange with a message about grants. Pasting a key through a form that eats
 * line breaks is the usual cause, so the key is parsed once, here, where the
 * answer can name the problem.
 */
function privateKeyProblem(privateKey) {
  try {
    crypto.createPrivateKey(privateKey);
    return '';
  } catch (_) {
    return 'is not a usable private key — its line breaks were most likely lost when it was pasted. '
      + 'Paste it with its \\n escapes intact, use a multi-line value, or point '
      + 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE at the JSON key file instead';
  }
}

/**
 * What is still missing or wrong before rows can be written, as a list of
 * environment variable names with the reason. Empty means the export is ready
 * to run.
 */
function missingConfig() {
  const missing = [];
  if (!target().spreadsheetId) missing.push('GOOGLE_SHEETS_SPREADSHEET_ID');
  try {
    const creds = credentials();
    if (!creds) {
      missing.push('GOOGLE_SERVICE_ACCOUNT_KEY_FILE (or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)');
    } else {
      const problem = privateKeyProblem(creds.privateKey);
      if (problem) {
        const source = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
          ? 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE'
          : 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY';
        missing.push(`${source} ${problem}`);
      }
    }
  } catch (err) {
    missing.push(`GOOGLE_SERVICE_ACCOUNT_KEY_FILE (${err.message})`);
  }
  return missing;
}

function isConfigured() {
  return missingConfig().length === 0;
}

/** The service account the rows are written as, or null when none is set. */
function serviceAccountEmail() {
  try {
    const creds = credentials();
    return creds ? creds.clientEmail : null;
  } catch (_) {
    return null;   // an unreadable key file is already reported by missingConfig
  }
}

/**
 * An authenticated Sheets client for this service account.
 *
 * `authClient` and `rootUrl` exist so the request can be pointed at a stub —
 * that is how the append is tested without a Google account. Neither is set in
 * normal operation.
 */
function client({ authClient = null, rootUrl = null } = {}) {
  let google = authClient;
  if (!google) {
    const creds = credentials();
    if (!creds) throw new Error('Google Sheets export is not configured — no service account credentials.');
    google = new auth.JWT({ email: creds.clientEmail, key: creds.privateKey, scopes: SCOPES });
  }
  const options = { version: 'v4', auth: google };
  const root = rootUrl || String(process.env.GOOGLE_SHEETS_ROOT_URL || '').trim();
  if (root) options.rootUrl = root;
  return sheets(options);
}

/** The first row of the range, or [] when the sheet is empty. */
async function firstRow(api, spreadsheetId, range) {
  const sheet = String(range).includes('!') ? String(range).split('!')[0] : '';
  const headerRange = sheet ? `${sheet}!1:1` : '1:1';
  const { data } = await api.spreadsheets.values.get({ spreadsheetId, range: headerRange });
  return (data.values && data.values[0]) || [];
}

/**
 * Append rows to the configured sheet, writing `header` first if the sheet is
 * still empty. Returns what the API reports it wrote.
 *
 * Rows are appended, never updated in place: the sheet is a running log, so a
 * run that writes the same day twice adds the rows twice. The caller decides
 * whether a day has already been exported (see injectorDailyExport).
 */
async function appendRows(rows, { header = null, spreadsheetId = null, range = null, authClient = null, rootUrl = null } = {}) {
  const list = Array.isArray(rows) ? rows.filter((row) => Array.isArray(row)) : [];
  const where = { ...target() };
  if (spreadsheetId) where.spreadsheetId = spreadsheetId;
  if (range) where.range = range;
  if (!where.spreadsheetId) throw new Error('No GOOGLE_SHEETS_SPREADSHEET_ID configured.');
  if (!list.length) return { appended: 0, updatedRange: '', headerWritten: false };

  const api = client({ authClient, rootUrl });
  let values = list;
  let headerWritten = false;
  if (header && header.length) {
    const existing = await firstRow(api, where.spreadsheetId, where.range);
    if (existing.length === 0) {
      values = [header, ...list];
      headerWritten = true;
    }
  }

  const { data } = await api.spreadsheets.values.append({
    spreadsheetId: where.spreadsheetId,
    range: where.range,
    valueInputOption: VALUE_INPUT_OPTION,
    insertDataOption: INSERT_DATA_OPTION,
    requestBody: { values },
  });

  const updates = data.updates || {};
  return {
    appended: Number(updates.updatedRows || 0) - (headerWritten ? 1 : 0),
    updatedRange: updates.updatedRange || '',
    headerWritten,
    spreadsheetId: where.spreadsheetId,
  };
}

module.exports = {
  SCOPES,
  client,
  privateKeyProblem,
  DEFAULT_RANGE,
  normalisePrivateKey,
  credentials,
  target,
  missingConfig,
  isConfigured,
  serviceAccountEmail,
  appendRows,
};
