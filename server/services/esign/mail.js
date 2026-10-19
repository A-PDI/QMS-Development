'use strict';
/**
 * E-mail for e-sign: invitations, completion notices (with the signed PDF),
 * declines and voids. Sent over SMTP with nodemailer.
 *
 * With no SMTP_HOST (or ESIGN_MAIL_TRANSPORT=json) messages are not sent —
 * they are logged, so the module works on a dev machine without a mail server.
 * The routes then hand the signing links back to the sender in the UI.
 */

const nodemailer = require('nodemailer');
const config = require('./config');

let cached = null;

function mailMode() {
  const smtp = config.smtp();
  if (smtp.transport === 'json') return 'json';
  return smtp.host ? 'smtp' : 'json';
}

function transporter() {
  const smtp = config.smtp();
  const mode = mailMode();
  const key = JSON.stringify({ mode, host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user });
  if (cached && cached.key === key) return cached.transport;
  const transport = mode === 'smtp'
    ? nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      })
    : nodemailer.createTransport({ jsonTransport: true });
  cached = { key, transport };
  return transport;
}

function fromAddress() {
  const smtp = config.smtp();
  return smtp.from || smtp.user || 'no-reply@localhost';
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:#1D2B4F;color:#fff;padding:18px 24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:600">${escapeHtml(config.sealName())} · e-Sign</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:19px;color:#1D2B4F">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(url, label) {
  return `<p style="margin:22px 0"><a href="${escapeHtml(url)}" style="background:#D4943A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#6b7280;word-break:break-all">Or paste this link into your browser:<br>${escapeHtml(url)}</p>`;
}

async function send(message) {
  const mode = mailMode();
  const info = await transporter().sendMail({ from: fromAddress(), ...message });
  if (mode === 'json') {
    console.log(`[esign] (mail not sent — no SMTP configured) To: ${message.to} | ${message.subject}`);
  }
  return { mode, messageId: info.messageId };
}

function invitation({ envelope, recipient, url, senderName, isReminder = false }) {
  const subject = `${isReminder ? 'Reminder: ' : ''}Please sign: ${envelope.title}`;
  const intro = `${escapeHtml(senderName || 'Someone')} has sent you <strong>${escapeHtml(envelope.title)}</strong> to review and sign.`;
  const note = envelope.message
    ? `<blockquote style="margin:14px 0;padding:10px 14px;background:#f8fafc;border-left:3px solid #1D2B4F;color:#374151">${escapeHtml(envelope.message).replace(/\n/g, '<br>')}</blockquote>`
    : '';
  const account = recipient.auth_method === 'account'
    ? '<p style="font-size:13px;color:#6b7280">You will be asked to sign in with your Microsoft work account before signing.</p>'
    : '<p style="font-size:13px;color:#6b7280">This link is unique to you — please do not forward it.</p>';
  const expires = envelope.expires_at
    ? `<p style="font-size:12px;color:#6b7280">The link expires on ${escapeHtml(new Date(envelope.expires_at).toDateString())}.</p>` : '';
  return send({
    to: `"${recipient.name.replace(/"/g, '')}" <${recipient.email}>`,
    subject,
    text: `${senderName || 'Someone'} has sent you "${envelope.title}" to sign.\n\n${envelope.message ? envelope.message + '\n\n' : ''}Open the document: ${url}\n`,
    html: layout(subject, `<p>Hello ${escapeHtml(recipient.name)},</p><p>${intro}</p>${note}${button(url, 'Review & sign')}${account}${expires}`),
  });
}

function completed({ envelope, to, name, pdf, downloadUrl }) {
  const subject = `Completed: ${envelope.title}`;
  const attach = pdf && pdf.length <= config.maxAttachMb() * 1024 * 1024;
  const body = `<p>Hello ${escapeHtml(name || '')},</p><p>All parties have signed <strong>${escapeHtml(envelope.title)}</strong>.
${attach ? 'The signed copy, with its certificate of completion, is attached.' : 'Download the signed copy here:'}</p>
${!attach && downloadUrl ? button(downloadUrl, 'Download signed PDF') : ''}`;
  return send({
    to,
    subject,
    text: `All parties have signed "${envelope.title}".${attach ? ' The signed copy is attached.' : downloadUrl ? ` Download: ${downloadUrl}` : ''}`,
    html: layout(subject, body),
    attachments: attach ? [{ filename: signedFilename(envelope), content: pdf, contentType: 'application/pdf' }] : [],
  });
}

function declined({ envelope, to, recipient, reason }) {
  const subject = `Declined: ${envelope.title}`;
  return send({
    to,
    subject,
    text: `${recipient.name} <${recipient.email}> declined to sign "${envelope.title}".\nReason: ${reason}`,
    html: layout(subject, `<p><strong>${escapeHtml(recipient.name)}</strong> (${escapeHtml(recipient.email)}) declined to sign <strong>${escapeHtml(envelope.title)}</strong>.</p>
<p style="padding:10px 14px;background:#fdecea;border-radius:8px">Reason: ${escapeHtml(reason)}</p>`),
  });
}

function voided({ envelope, recipient, reason }) {
  const subject = `Voided: ${envelope.title}`;
  return send({
    to: `"${recipient.name.replace(/"/g, '')}" <${recipient.email}>`,
    subject,
    text: `"${envelope.title}" has been voided by the sender and no longer needs your signature.${reason ? `\nReason: ${reason}` : ''}`,
    html: layout(subject, `<p>Hello ${escapeHtml(recipient.name)},</p><p><strong>${escapeHtml(envelope.title)}</strong> has been voided by the sender and no longer needs your signature.</p>${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}`),
  });
}

function signedFilename(envelope) {
  const base = String(envelope.title || 'document').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'document';
  return `${base} - signed.pdf`;
}

module.exports = { mailMode, invitation, completed, declined, voided, signedFilename, escapeHtml };
