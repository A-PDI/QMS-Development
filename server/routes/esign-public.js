'use strict';
/**
 * E-sign — signer side. Mounted at /api/esign/public with NO login required:
 * the unguessable token in the URL is the credential. Recipients set up for
 * "Microsoft account" authentication must also be signed in to the app as the
 * same e-mail address (checked via the optional Bearer token).
 *
 *   GET  /:token            what to show the signer
 *   GET  /:token/document   the PDF (working copy, or the signed copy once complete)
 *   POST /:token/consent    agree to sign electronically
 *   POST /:token/sign       { values, signature, initials }
 *   POST /:token/decline    { reason }
 *   GET  /:token/download   the completed, sealed PDF
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db/adapter');
const wf = require('../services/esign/workflow');
const { sendPdf } = require('./esign');

const router = express.Router();

/** Attach req.user when a valid app JWT is present; never rejects. */
function optionalUser(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      const user = db.get('SELECT id, name, email, role FROM users WHERE id = ? AND active = 1', [payload.userId]);
      if (user) req.user = user;
    } catch (_) { /* treated as anonymous */ }
  }
  next();
}

router.use(optionalUser);

function context(req) {
  return wf.resolveToken(req.params.token, req.user);
}

router.get('/:token', (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(wf.viewForSigner(context(req), req));
  } catch (err) { next(err); }
});

router.get('/:token/document', (req, res, next) => {
  try {
    const ctx = context(req);
    sendPdf(res, { bytes: wf.documentForSigner(ctx), filename: ctx.envelope.original_name });
  } catch (err) { next(err); }
});

router.post('/:token/consent', (req, res, next) => {
  try {
    res.json(wf.recordConsent(context(req), req));
  } catch (err) { next(err); }
});

router.post('/:token/sign', async (req, res, next) => {
  try {
    const result = await wf.signAsRecipient(context(req), req, req.body || {});
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:token/decline', async (req, res, next) => {
  try {
    res.json(await wf.declineAsRecipient(context(req), req, req.body?.reason));
  } catch (err) { next(err); }
});

router.get('/:token/download', (req, res, next) => {
  try {
    sendPdf(res, wf.signedForSigner(context(req)), 'attachment');
  } catch (err) { next(err); }
});

module.exports = router;
