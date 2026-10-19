'use strict';
/**
 * E-sign — sender side. Mounted at /api/esign behind authMiddleware.
 *
 *   GET    /                      list envelopes (admins: all; others: their own)
 *   POST   /                      upload a PDF (multipart "file") → draft envelope
 *   GET    /inbox                 documents waiting for MY signature
 *   POST   /inbox/:recipientId/start   → { path: "/sign/<token>" }
 *   GET    /:id                   envelope + recipients + fields + audit
 *   PATCH  /:id                   title / message / routing (draft)
 *   PUT    /:id/recipients        replace recipients (draft)
 *   PUT    /:id/fields            replace fields (draft)
 *   POST   /:id/detect            re-run field detection (draft)
 *   POST   /:id/send              send for signature
 *   POST   /:id/resend            re-send invitations to the current signers
 *   POST   /:id/void              { reason }
 *   POST   /:id/finalize          retry sealing after everyone signed
 *   DELETE /:id                   delete a draft / voided / declined / expired envelope
 *   GET    /:id/file/:kind        original | current | signed (PDF)
 */

const express = require('express');
const multer = require('multer');
const config = require('../services/esign/config');
const wf = require('../services/esign/workflow');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxPdfMb() * 1024 * 1024, files: 1 },
});

function sendPdf(res, { bytes, filename }, disposition = 'inline') {
  const safe = String(filename || 'document.pdf').replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': bytes.length,
    'Content-Disposition': `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename || 'document.pdf')}`,
    'Cache-Control': 'no-store',
  });
  res.end(bytes);
}

router.get('/', (req, res, next) => {
  try {
    res.json(wf.listEnvelopes(req.user, req.query));
  } catch (err) { next(err); }
});

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          throw new wf.EsignError(`The PDF is larger than ${config.maxPdfMb()} MB`, 413, 'FILE_TOO_LARGE');
        }
        throw uploadErr;
      }
      if (!req.file) throw new wf.EsignError('Choose a PDF to upload (form field "file")');
      const env = await wf.createEnvelope({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        title: req.body.title,
        message: req.body.message,
        routing: req.body.routing,
        user: req.user,
      });
      res.status(201).json({ envelope: { id: env.id, title: env.title, status: env.status } });
    } catch (err) { next(err); }
  });
});

router.get('/inbox', (req, res, next) => {
  try {
    res.json({ items: wf.inbox(req.user) });
  } catch (err) { next(err); }
});

router.post('/inbox/:recipientId/start', (req, res, next) => {
  try {
    res.json(wf.startInboxSigning(req.user, req.params.recipientId));
  } catch (err) { next(err); }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(wf.getEnvelopeDetail(req.user, req.params.id));
  } catch (err) { next(err); }
});

router.patch('/:id', (req, res, next) => {
  try {
    wf.updateDraft(req.user, req.params.id, req.body || {});
    res.json(wf.getEnvelopeDetail(req.user, req.params.id));
  } catch (err) { next(err); }
});

router.put('/:id/recipients', (req, res, next) => {
  try {
    const recipients = wf.setRecipients(req.user, req.params.id, req.body?.recipients);
    res.json({ recipients });
  } catch (err) { next(err); }
});

router.put('/:id/fields', (req, res, next) => {
  try {
    const fields = wf.setFields(req.user, req.params.id, req.body?.fields);
    res.json({ fields });
  } catch (err) { next(err); }
});

router.post('/:id/detect', async (req, res, next) => {
  try {
    const detail = wf.getEnvelopeDetail(req.user, req.params.id);
    if (detail.envelope.status !== 'draft') throw new wf.EsignError('Only a draft can be re-detected', 409, 'NOT_DRAFT');
    await wf.runDetection(req.params.id);
    res.json(wf.getEnvelopeDetail(req.user, req.params.id));
  } catch (err) { next(err); }
});

router.post('/:id/send', async (req, res, next) => {
  try {
    const result = await wf.sendEnvelope(req.user, req.params.id);
    // Signing links are echoed back only when they were not e-mailed (no SMTP
    // configured, or the send failed), so the sender can share them directly.
    if (result.mail_mode === 'smtp') {
      result.links = result.links.filter((l) => l.error);
    }
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/resend', async (req, res, next) => {
  try {
    const result = await wf.resendInvitations(req.user, req.params.id);
    if (result.mail_mode === 'smtp') {
      result.links = result.links.filter((l) => l.error);
    }
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/void', async (req, res, next) => {
  try {
    const envelope = await wf.voidEnvelope(req.user, req.params.id, req.body?.reason);
    res.json({ envelope });
  } catch (err) { next(err); }
});

router.post('/:id/finalize', async (req, res, next) => {
  try {
    const envelope = await wf.retryFinalize(req.user, req.params.id);
    res.json({ envelope });
  } catch (err) { next(err); }
});

router.delete('/:id', (req, res, next) => {
  try {
    wf.deleteDraft(req.user, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/file/:kind', (req, res, next) => {
  try {
    const file = wf.fileForManager(req.user, req.params.id, req.params.kind);
    sendPdf(res, file, req.query.download === '1' ? 'attachment' : 'inline');
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.sendPdf = sendPdf;
