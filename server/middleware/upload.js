'use strict';
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '25', 10);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Sanitise a user-supplied filename so only a safe ASCII base is stored on disk.
// The original filename is still tracked separately in the DB for display.
function sanitiseFilenameBase(originalName) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').slice(0, 80) || 'file';
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  return { safeBase, safeExt };
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Reject anything that isn't a valid UUID before any filesystem operation —
    // this prevents path-traversal via the :inspectionId route parameter.
    const inspectionId = req.params.inspectionId;
    if (!inspectionId || !UUID_RE.test(inspectionId)) {
      return cb(new Error('Invalid inspection id'));
    }

    const dir = path.resolve(path.join(UPLOAD_DIR, inspectionId));
    // Defense in depth: confirm the resolved target is inside UPLOAD_DIR.
    if (!dir.startsWith(UPLOAD_DIR + path.sep) && dir !== UPLOAD_DIR) {
      return cb(new Error('Resolved upload path escapes upload root'));
    }

    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return cb(err);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const { safeBase, safeExt } = sanitiseFilenameBase(file.originalname || 'file');
    const uuid = uuidv4().slice(0, 8);
    cb(null, `${safeBase}-${uuid}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 20,
  },
});

module.exports = upload;
