'use strict';
/**
 * The append request, made by the real Google client.
 *
 * A stub stands in for sheets.googleapis.com and records what arrives, so the
 * URL, query parameters and body this app sends are checked end to end — short
 * of Google itself — without a service account or a network. The client is the
 * published @googleapis/sheets one, so a breaking change in it fails here.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { auth } = require('@googleapis/sheets');
const googleSheets = require('../services/googleSheets');

/** A pre-authorised client, so no token is ever fetched from Google. */
function stubAuth() {
  const client = new auth.OAuth2();
  client.setCredentials({ access_token: 'stub-token', expiry_date: Date.now() + 3600000 });
  return client;
}

/**
 * Stand-in for the Sheets API. `firstRow` is what GET .../values/1:1 returns;
 * every request is recorded.
 */
async function serveSheets({ firstRow = [] } = {}) {
  const requests = [];
  const app = express();
  app.use(express.json());

  app.get('/v4/spreadsheets/:id/values/:range', (req, res) => {
    requests.push({ method: 'GET', path: req.path, params: req.params, query: req.query });
    res.json({ range: req.params.range, majorDimension: 'ROWS', values: firstRow.length ? [firstRow] : [] });
  });

  app.post('/v4/spreadsheets/:id/values/:range\\:append', (req, res) => {
    requests.push({ method: 'POST', path: req.path, params: req.params, query: req.query, body: req.body });
    const written = (req.body.values || []).length;
    res.json({
      spreadsheetId: req.params.id,
      tableRange: 'Sheet1!A1:C1',
      updates: { updatedRange: `Sheet1!A2:C${written + 1}`, updatedRows: written, updatedColumns: 3 },
    });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    requests,
    rootUrl: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('rows are appended to the configured sheet, with the header on an empty one', async () => {
  const sheets = await serveSheets({ firstRow: [] });
  try {
    const result = await googleSheets.appendRows(
      [['2026-06-30', '6513589PX', 'SN001'], ['2026-06-30', '6513589PX', 'SN002']],
      {
        header: ['Test Date', 'Part Number', 'Serial Number'],
        spreadsheetId: 'sheet-123',
        range: 'Passed!A:C',
        authClient: stubAuth(),
        rootUrl: sheets.rootUrl,
      },
    );

    const [read, append] = sheets.requests;
    assert.strictEqual(read.method, 'GET');
    assert.strictEqual(read.params.range, 'Passed!1:1', 'the header check reads row 1 of the same tab');

    assert.strictEqual(append.method, 'POST');
    assert.strictEqual(append.params.id, 'sheet-123');
    assert.strictEqual(append.params.range, 'Passed!A:C');
    assert.strictEqual(append.query.valueInputOption, 'USER_ENTERED');
    assert.strictEqual(append.query.insertDataOption, 'INSERT_ROWS');
    assert.deepStrictEqual(append.body.values, [
      ['Test Date', 'Part Number', 'Serial Number'],
      ['2026-06-30', '6513589PX', 'SN001'],
      ['2026-06-30', '6513589PX', 'SN002'],
    ]);

    assert.deepStrictEqual(
      { appended: result.appended, headerWritten: result.headerWritten, updatedRange: result.updatedRange },
      // The stub echoes the range for all three written rows; `appended` is the
      // count the export reports, with the header taken back off.
      { appended: 2, headerWritten: true, updatedRange: 'Sheet1!A2:C4' },
      'the header is not counted as an exported row',
    );
  } finally {
    await sheets.close();
  }
});

test('a sheet that already has a header gains only the rows', async () => {
  const sheets = await serveSheets({ firstRow: ['Test Date', 'Part Number', 'Serial Number'] });
  try {
    const result = await googleSheets.appendRows(
      [['2026-07-01', 'PN-9', 'SN003']],
      {
        header: ['Test Date', 'Part Number', 'Serial Number'],
        spreadsheetId: 'sheet-123',
        range: 'Passed!A:C',
        authClient: stubAuth(),
        rootUrl: sheets.rootUrl,
      },
    );
    const append = sheets.requests.find((r) => r.method === 'POST');
    assert.deepStrictEqual(append.body.values, [['2026-07-01', 'PN-9', 'SN003']]);
    assert.strictEqual(result.headerWritten, false);
    assert.strictEqual(result.appended, 1);
  } finally {
    await sheets.close();
  }
});

test('nothing is sent when there is nothing to append', async () => {
  const sheets = await serveSheets();
  try {
    const result = await googleSheets.appendRows([], {
      spreadsheetId: 'sheet-123',
      authClient: stubAuth(),
      rootUrl: sheets.rootUrl,
    });
    assert.deepStrictEqual(result, { appended: 0, updatedRange: '', headerWritten: false });
    assert.strictEqual(sheets.requests.length, 0);
  } finally {
    await sheets.close();
  }
});

test('an error from Google is raised rather than silently losing the rows', async () => {
  const app = express();
  app.use((req, res) => res.status(403).json({
    error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' },
  }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();

  try {
    await assert.rejects(
      () => googleSheets.appendRows([['2026-06-30', 'PN-1', 'SN001']], {
        spreadsheetId: 'sheet-123',
        authClient: stubAuth(),
        rootUrl: `http://127.0.0.1:${port}/`,
      }),
      /permission/i,
      'a sheet that was never shared with the service account must fail loudly',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ── Configuration the operator gets wrong ───────────────────────────────────
// A private key reaches the server through a .env file, a Render environment
// variable or a mounted JSON key, and the line breaks are what survive or do
// not. These are the forms each of those produces.
const { generateKeyPairSync } = require('node:crypto');
const PEM = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

function withEnv(values, fn) {
  const names = [
    'GOOGLE_SHEETS_SPREADSHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
  ];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, values);
    return fn();
  } finally {
    for (const name of names) {
      if (saved[name] == null) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test('every form a key arrives in is accepted, however its newlines are written', () => {
  const forms = {
    'escaped \\n, unquoted': PEM.replace(/\n/g, '\\n'),
    'escaped \\n, quoted': `"${PEM.replace(/\n/g, '\\n')}"`,
    'real newlines': PEM,
  };
  for (const [name, value] of Object.entries(forms)) {
    withEnv({
      GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.iam.gserviceaccount.com',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: value,
    }, () => {
      assert.deepStrictEqual(googleSheets.missingConfig(), [], `${name} should be accepted`);
      assert.strictEqual(googleSheets.privateKeyProblem(googleSheets.credentials().privateKey), '');
    });
  }
});

test('a key whose line breaks were lost is refused, by name, instead of failing nightly', () => {
  withEnv({
    GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.iam.gserviceaccount.com',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: PEM.replace(/\n/g, ' '),
  }, () => {
    assert.strictEqual(googleSheets.isConfigured(), false, 'a key that cannot be loaded is not configuration');
    const [problem] = googleSheets.missingConfig();
    assert.match(problem, /^GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
    assert.match(problem, /line breaks/);
  });
});

test('a mounted JSON key file is read whole, with no escaping to get wrong', () => {
  const file = path.join(os.tmpdir(), `qms-sa-key-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({
    type: 'service_account',
    client_email: 'svc@example.iam.gserviceaccount.com',
    private_key: PEM,
  }));
  try {
    withEnv({ GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id', GOOGLE_SERVICE_ACCOUNT_KEY_FILE: file }, () => {
      assert.deepStrictEqual(googleSheets.missingConfig(), []);
      assert.strictEqual(googleSheets.credentials().clientEmail, 'svc@example.iam.gserviceaccount.com');
      assert.strictEqual(googleSheets.privateKeyProblem(googleSheets.credentials().privateKey), '');
    });

    // A JSON file that is not a service account key says so, rather than
    // failing later with a missing-field error.
    fs.writeFileSync(file, JSON.stringify({ installed: { client_id: 'oauth-client' } }));
    withEnv({ GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id', GOOGLE_SERVICE_ACCOUNT_KEY_FILE: file }, () => {
      assert.match(googleSheets.missingConfig()[0], /not a service account key/);
    });
  } finally {
    fs.unlinkSync(file);
  }
});

test('the spreadsheet id is required before anything is attempted', async () => {
  await assert.rejects(
    () => googleSheets.appendRows([['a', 'b', 'c']], { spreadsheetId: '', authClient: stubAuth() }),
    /GOOGLE_SHEETS_SPREADSHEET_ID/,
  );
});
