'use strict';
/**
 * E-sign — /api/esign (sender) and /api/esign/public (signer).
 *
 * Runs the whole lifecycle against throwaway routers: upload → detection (a
 * fake detector service) → recipients and fields → send → two signers in
 * sequence (one by e-mail link, one who must be signed in) → sealed PDF with a
 * certificate of completion. Also covers decline, void, resend, expiry and the
 * access rules.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const forge = require('node-forge');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const { db, tmpDir } = require('./helpers/testEnv');
const { errorHandler } = require('../middleware/error');

// ── Environment for the module ───────────────────────────────────────────────
process.env.ESIGN_MAIL_TRANSPORT = 'json';
process.env.ESIGN_PUBLIC_URL = 'https://qms.example.test';
process.env.ESIGN_P12_PASSPHRASE = 'test-passphrase-123';
process.env.ESIGN_P12_PATH = path.join(tmpDir, 'seal.p12');
process.env.ESIGN_TIME_ZONE = 'America/Denver';

function makeP12(file, passphrase) {
  const keys = forge.pki.rsa.generateKeyPair(1024); // small key: tests only
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 864e5);
  cert.validity.notAfter = new Date(Date.now() + 365 * 864e5);
  const attrs = [{ name: 'commonName', value: 'Test Seal' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' });
  fs.writeFileSync(file, Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'));
}
makeP12(process.env.ESIGN_P12_PATH, process.env.ESIGN_P12_PASSPHRASE);

// A fake detector: returns one signature and one date field on page 1.
let detectorCalls = 0;
const detector = http.createServer((req, res) => {
  detectorCalls++;
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      pages: [], ml_used: true,
      fields: [
        { page: 0, x: 120, y: 200, width: 200, height: 20, type: 'signature', label: 'Signed:', source: 'ml', role_hint: 'supplier', confidence: 0.4, required: true },
        { page: 0, x: 120, y: 170, width: 120, height: 18, type: 'date', label: 'Date:', source: 'ml', confidence: 0.3, required: true },
        { page: 9, x: 1, y: 1, width: 10, height: 10, type: 'signature' }, // bad page → dropped
        { page: 0, x: 1, y: 1, width: 10, height: 10, type: 'bogus' },     // bad type → dropped
      ],
    }));
  });
});

const wf = require('../services/esign/workflow');
const esignRoutes = require('../routes/esign');
const esignPublicRoutes = require('../routes/esign-public');

const OWNER = { id: 'u-es-owner', name: 'Olivia Owner', email: 'olivia@pdi.test', role: 'inspector' };
const OTHER = { id: 'u-es-other', name: 'Oscar Other', email: 'oscar@pdi.test', role: 'inspector' };
const ADMIN = { id: 'u-es-admin', name: 'Ada Admin', email: 'ada@pdi.test', role: 'admin' };
const STAFF = { id: 'u-es-staff', name: 'Sam Staff', email: 'sam@pdi.test', role: 'inspector' };
for (const u of [OWNER, OTHER, ADMIN, STAFF]) {
  db.run('INSERT OR IGNORE INTO users (id, name, email, role, active) VALUES (?, ?, ?, ?, 1)', [u.id, u.name, u.email, u.role]);
}

const PNG_SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAAUCAYAAADRA14pAAAAm0lEQVR42u2WOw6AMAxDY0ZmTscBOR0zK0xIVcWnLXFSpHhhs/PiVlQkFAr9UeM07yIiA8P0/PYCms4DTdBc27rAu9F8DjCM78KsYa+yodXqlbk1eEkeGKDW0DUZYBlbQLf4gtGqBfTTPf0EzBrUa3Fgtqo5tNbiYQnaAqB9wtDzb6T1nr4CW7VaCs5cPNLQXp6C3s9SN+hQqF4H5saQ2fGNHCsAAAAASUVORK5CYII=';

async function samplePdf(pages = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Supplier Agreement page ${i + 1}`, { x: 72, y: 720, size: 14, font });
    p.drawText('Signed:', { x: 72, y: 205, size: 11, font });
  }
  return Buffer.from(await doc.save());
}

let server;
let base;
let currentUser = OWNER;

test.before(async () => {
  await new Promise((r) => detector.listen(0, '127.0.0.1', r));
  process.env.ESIGN_DETECTOR_URL = `http://127.0.0.1:${detector.address().port}`;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/esign/public', esignPublicRoutes);
  app.use('/api/esign', (req, res, next) => { req.user = currentUser; next(); }, esignRoutes);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/esign`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => detector.close(r));
});

async function call(method, url, { body, as, bearer } = {}) {
  if (as) currentUser = as;
  const headers = {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(url.startsWith('http') ? url : base + url, { method, headers, body: payload });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  currentUser = OWNER;
  return { status: res.status, body: data, headers: res.headers };
}

async function createEnvelope(title = 'Supplier NDA', routing = 'sequential', as = OWNER) {
  const form = new FormData();
  form.append('file', new Blob([await samplePdf()], { type: 'application/pdf' }), 'nda.pdf');
  form.append('title', title);
  form.append('routing', routing);
  const res = await call('POST', '/', { body: form, as });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  const id = res.body.envelope.id;
  for (let i = 0; i < 100; i++) {
    const d = (await call('GET', `/${id}`, { as })).body;
    if (d.envelope.detection_status !== 'pending') return d;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('detection never finished');
}

const tokenFromUrl = (url) => url.split('/sign/')[1];

test('full sequential flow: link signer then signed-in staff signer → sealed PDF', async () => {
  const draft = await createEnvelope();
  const id = draft.envelope.id;
  assert.ok(detectorCalls >= 1);
  assert.strictEqual(draft.envelope.detection_status, 'done');
  assert.strictEqual(draft.fields.length, 2, 'bad detector rows are dropped');
  assert.deepStrictEqual(draft.fields.map((f) => f.type).sort(), ['date', 'signature']);
  assert.strictEqual(draft.envelope.pages.length, 2);

  // Another inspector cannot see it; an admin can.
  assert.strictEqual((await call('GET', `/${id}`, { as: OTHER })).status, 403);
  assert.strictEqual((await call('GET', `/${id}`, { as: ADMIN })).status, 200);

  const rec = await call('PUT', `/${id}/recipients`, {
    body: { recipients: [
      { name: 'Vera Vendor', email: 'Vera@Supplier.test', role_label: 'Supplier', routing_order: 1 },
      { name: 'Sam Staff', email: 'sam@pdi.test', role_label: 'PDI', routing_order: 2, auth_method: 'account' },
    ] },
  });
  assert.strictEqual(rec.status, 200, JSON.stringify(rec.body));
  const [vera, sam] = rec.body.recipients;
  assert.strictEqual(vera.email, 'vera@supplier.test', 'e-mails are normalized');

  // Sending with unassigned fields is refused.
  const early = await call('POST', `/${id}/send`);
  assert.strictEqual(early.status, 400);
  assert.strictEqual(early.body.code, 'UNASSIGNED_FIELDS');

  const det = draft.fields;
  const fields = [
    { ...det.find((f) => f.type === 'signature'), recipient_id: vera.id },
    { ...det.find((f) => f.type === 'date'), recipient_id: vera.id },
    { page: 0, x: 330, y: 200, width: 150, height: 18, type: 'name', recipient_id: vera.id, required: true },
    { page: 1, x: 120, y: 200, width: 200, height: 24, type: 'signature', recipient_id: sam.id },
    { page: 1, x: 340, y: 205, width: 14, height: 14, type: 'checkbox', recipient_id: sam.id, required: true, label: 'I approve' },
    { page: 1, x: 120, y: 160, width: 160, height: 18, type: 'title', recipient_id: sam.id, required: false },
  ];
  const outside = await call('PUT', `/${id}/fields`, { body: { fields: [{ ...fields[0], x: 700 }] } });
  assert.strictEqual(outside.status, 400, 'a field off the page is rejected');
  const saved = await call('PUT', `/${id}/fields`, { body: { fields } });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

  const sent = await call('POST', `/${id}/send`);
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
  assert.strictEqual(sent.body.envelope.status, 'sent');
  assert.strictEqual(sent.body.mail_mode, 'json');
  assert.strictEqual(sent.body.links.length, 1, 'only the first signer is invited');
  const veraToken = tokenFromUrl(sent.body.links[0].url);
  assert.ok(sent.body.links[0].url.startsWith('https://qms.example.test/sign/'));

  // Drafts are locked once sent.
  assert.strictEqual((await call('PUT', `/${id}/fields`, { body: { fields } })).body.code, 'NOT_DRAFT');

  // ── Vera (e-mail link) ──
  const view = await call('GET', `/public/${veraToken}`);
  assert.strictEqual(view.status, 200);
  assert.strictEqual(view.body.can_sign, true);
  assert.strictEqual(view.body.fields.length, 3);
  assert.strictEqual(view.body.fields.find((f) => f.type === 'name').value, 'Vera Vendor', 'name is prefilled');
  const doc = await call('GET', `/public/${veraToken}/document`);
  assert.strictEqual(doc.headers.get('content-type'), 'application/pdf');

  const noConsent = await call('POST', `/public/${veraToken}/sign`, { body: { signature: { method: 'drawn', image: PNG_SIG } } });
  assert.strictEqual(noConsent.body.code, 'CONSENT_REQUIRED');
  assert.strictEqual((await call('POST', `/public/${veraToken}/consent`)).status, 200);
  const badImg = await call('POST', `/public/${veraToken}/sign`, { body: { signature: { method: 'drawn', image: 'data:image/png;base64,AAAA' } } });
  assert.strictEqual(badImg.status, 400);
  const veraSigned = await call('POST', `/public/${veraToken}/sign`, { body: { signature: { method: 'drawn', image: PNG_SIG } } });
  assert.strictEqual(veraSigned.status, 200, JSON.stringify(veraSigned.body));
  assert.strictEqual(veraSigned.body.completed, false);
  const again = await call('GET', `/public/${veraToken}`);
  assert.strictEqual(again.body.can_sign, false, 'cannot sign twice');

  // ── Sam (must be signed in as sam@pdi.test) ──
  const inbox = await call('GET', '/inbox', { as: STAFF });
  assert.strictEqual(inbox.body.items.length, 1);
  assert.strictEqual(inbox.body.items[0].title, 'Supplier NDA');
  const start = await call('POST', `/inbox/${inbox.body.items[0].recipient_id}/start`, { as: STAFF });
  assert.ok(start.body.path.startsWith('/sign/'));
  const samToken = start.body.path.slice('/sign/'.length);
  assert.strictEqual((await call('POST', `/inbox/${inbox.body.items[0].recipient_id}/start`, { as: OTHER })).status, 404);

  const anon = await call('GET', `/public/${samToken}`);
  assert.strictEqual(anon.status, 401);
  assert.strictEqual(anon.body.code, 'LOGIN_REQUIRED');
  const wrong = await call('GET', `/public/${samToken}`, { bearer: jwt.sign({ userId: OTHER.id }, process.env.JWT_SECRET) });
  assert.strictEqual(wrong.body.code, 'WRONG_ACCOUNT');
  const samJwt = jwt.sign({ userId: STAFF.id }, process.env.JWT_SECRET);
  assert.strictEqual((await call('GET', `/public/${samToken}`, { bearer: samJwt })).body.can_sign, true);
  await call('POST', `/public/${samToken}/consent`, { bearer: samJwt });
  const missingBox = await call('POST', `/public/${samToken}/sign`, {
    bearer: samJwt, body: { signature: { method: 'typed', text: 'Sam Staff', image: PNG_SIG }, values: {} },
  });
  assert.strictEqual(missingBox.body.code, 'FIELD_REQUIRED');
  const checkbox = view.body.fields.length ? (await call('GET', `/${id}`)).body.fields.find((f) => f.type === 'checkbox') : null;
  const samSigned = await call('POST', `/public/${samToken}/sign`, {
    bearer: samJwt,
    body: { signature: { method: 'typed', text: 'Sam Staff', image: PNG_SIG }, values: { [checkbox.id]: true } },
  });
  assert.strictEqual(samSigned.status, 200, JSON.stringify(samSigned.body));
  assert.strictEqual(samSigned.body.completed, true);

  // ── Result ──
  const done = (await call('GET', `/${id}`)).body;
  assert.strictEqual(done.envelope.status, 'completed');
  assert.strictEqual(done.envelope.sealed, true);
  assert.match(done.envelope.signed_sha256, /^[0-9a-f]{64}$/);
  const events = done.audit.map((a) => a.event);
  for (const e of ['created', 'sent', 'invited', 'viewed', 'consented', 'signed', 'completed', 'sealed']) {
    assert.ok(events.includes(e), `audit has ${e}`);
  }
  assert.ok(done.fields.find((f) => f.type === 'date').value.match(/^\d{2}\/\d{2}\/\d{4}$/));

  const signed = await call('GET', `/${id}/file/signed`);
  assert.strictEqual(signed.status, 200);
  const pdf = await PDFDocument.load(signed.body);
  assert.ok(pdf.getPageCount() >= 3, 'certificate page appended');
  assert.ok(signed.body.includes('/ByteRange'), 'sealed with a digital signature');
  assert.strictEqual(require('crypto').createHash('sha256').update(signed.body).digest('hex'), done.envelope.signed_sha256);

  // Signers can download the signed copy with their link.
  const dl = await call('GET', `/public/${veraToken}/download`);
  assert.strictEqual(dl.status, 200);
  assert.ok(dl.body.equals(signed.body));
});

test('decline closes the envelope and kills the links', async () => {
  const draft = await createEnvelope('Decline me', 'parallel');
  const id = draft.envelope.id;
  const { recipients } = (await call('PUT', `/${id}/recipients`, {
    body: { recipients: [{ name: 'A One', email: 'a@x.test' }, { name: 'B Two', email: 'b@x.test' }] },
  })).body;
  assert.ok(recipients.every((r) => r.routing_order === 1), 'parallel routing puts everyone first');
  await call('PUT', `/${id}/fields`, { body: { fields: recipients.map((r, i) => ({ page: 0, x: 100, y: 100 + i * 40, width: 150, height: 20, type: 'signature', recipient_id: r.id })) } });
  const sent = await call('POST', `/${id}/send`);
  assert.strictEqual(sent.body.links.length, 2, 'parallel invites everyone at once');
  const [ta, tb] = sent.body.links.map((l) => tokenFromUrl(l.url));
  assert.strictEqual((await call('POST', `/public/${ta}/decline`, { body: { reason: '' } })).status, 400, 'a reason is required');
  assert.strictEqual((await call('POST', `/public/${ta}/decline`, { body: { reason: 'Terms not agreed' } })).status, 200);
  assert.strictEqual((await call('GET', `/${id}`)).body.envelope.status, 'declined');
  assert.strictEqual((await call('GET', `/public/${tb}`)).body.code, 'LINK_REVOKED');
});

test('void, resend and expiry', async () => {
  const draft = await createEnvelope('Void me');
  const id = draft.envelope.id;
  const { recipients } = (await call('PUT', `/${id}/recipients`, { body: { recipients: [{ name: 'C Three', email: 'c@x.test' }] } })).body;
  const noSig = await call('PUT', `/${id}/fields`, { body: { fields: [{ page: 0, x: 100, y: 100, width: 120, height: 18, type: 'text', recipient_id: recipients[0].id }] } });
  assert.strictEqual(noSig.status, 200);
  assert.strictEqual((await call('POST', `/${id}/send`)).body.code, 'MISSING_SIGNATURE');
  await call('PUT', `/${id}/fields`, { body: { fields: [{ page: 0, x: 100, y: 100, width: 150, height: 20, type: 'signature', recipient_id: recipients[0].id }] } });
  const sent = await call('POST', `/${id}/send`);
  const first = tokenFromUrl(sent.body.links[0].url);

  const resent = await call('POST', `/${id}/resend`);
  assert.strictEqual(resent.status, 200);
  assert.strictEqual((await call('GET', `/public/${first}`)).body.code, 'LINK_REVOKED', 're-sending replaces the old link');
  const second = tokenFromUrl(resent.body.links[0].url);
  assert.strictEqual((await call('GET', `/public/${second}`)).body.can_sign, true);

  // Expiry.
  db.run('UPDATE esign_envelopes SET expires_at = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), id]);
  const expired = await call('GET', `/public/${second}`);
  assert.strictEqual(expired.body.can_sign, false);
  assert.strictEqual((await call('GET', `/${id}`)).body.envelope.status, 'expired');

  // Void needs status sent; a fresh one.
  const d2 = await createEnvelope('Void me 2');
  const r2 = (await call('PUT', `/${d2.envelope.id}/recipients`, { body: { recipients: [{ name: 'D Four', email: 'd@x.test' }] } })).body.recipients;
  await call('PUT', `/${d2.envelope.id}/fields`, { body: { fields: [{ page: 0, x: 100, y: 100, width: 150, height: 20, type: 'signature', recipient_id: r2[0].id }] } });
  const s2 = await call('POST', `/${d2.envelope.id}/send`);
  assert.strictEqual((await call('POST', `/${d2.envelope.id}/void`, { body: { reason: 'Wrong revision', }, as: OTHER })).status, 403);
  const voided = await call('POST', `/${d2.envelope.id}/void`, { body: { reason: 'Wrong revision' } });
  assert.strictEqual(voided.body.envelope.status, 'voided');
  assert.strictEqual((await call('GET', `/public/${tokenFromUrl(s2.body.links[0].url)}`)).body.code, 'LINK_REVOKED');
  assert.strictEqual((await call('DELETE', `/${d2.envelope.id}`)).status, 200, 'voided envelopes can be deleted');
});

test('uploads are validated and lists are scoped to the owner', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('not a pdf')], { type: 'application/pdf' }), 'x.pdf');
  const bad = await call('POST', '/', { body: form });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.code, 'BAD_PDF');

  await createEnvelope('Other person doc', 'sequential', OTHER);
  const mine = (await call('GET', '/')).body.envelopes;
  assert.ok(mine.every((e) => e.created_by === OWNER.id));
  const all = (await call('GET', '/', { as: ADMIN })).body.envelopes;
  assert.ok(all.some((e) => e.created_by === OTHER.id));
  assert.strictEqual((await call('GET', '/public/not-a-real-token-but-long-enough-xxxxxxxxxx')).status, 404);
});

test('stamping draws upright on rotated pages', async () => {
  const esignPdf = require('../services/esign/pdf');
  const field = { x: 100, y: 200, width: 20, height: 150 };
  // At 90°, the box's display width runs along user-space y.
  const f90 = esignPdf.displayFrame(field, 90);
  assert.strictEqual(f90.dispW, 150);
  assert.strictEqual(f90.dispH, 20);
  assert.deepStrictEqual(f90.toUser(0, 0), [120, 200]);
  const f270 = esignPdf.displayFrame(field, 270);
  assert.deepStrictEqual(f270.toUser(0, 0), [100, 350]);
  assert.strictEqual(esignPdf.normalizeRotation(-90), 270);
});

test('the sealing certificate can seal more than one document per process', async () => {
  const esignPdf = require('../services/esign/pdf');
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const working = Buffer.from(await doc.save());
  const certificate = {
    envelopeId: 'seal-twice', title: 'Seal twice', originalName: 'a.pdf', originalSha256: 'x'.repeat(64),
    pageCount: 1, senderName: 'Sender', senderEmail: 'sender@example.test', sentAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), routing: 'sequential', recipients: [], audit: [],
  };
  for (let i = 0; i < 3; i++) {
    const out = await esignPdf.finalizeDocument(working, certificate);
    assert.strictEqual(out.sealed, true, `document ${i + 1} is sealed`);
    assert.ok(out.bytes.includes(Buffer.from('/ByteRange')), `document ${i + 1} has a signature`);
  }
});
