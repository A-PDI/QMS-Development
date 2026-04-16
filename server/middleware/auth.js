'use strict';
const jwt = require('jsonwebtoken');
const db = require('../db/adapter');
const { AppError } = require('./error');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Missing or invalid authorization header', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const user = db.get('SELECT * FROM users WHERE id = ? AND active = 1', [payload.userId]);
    if (!user) {
      return next(new AppError('User not found or inactive', 401, 'UNAUTHORIZED'));
    }
    req.user = user;
    next();
  } catch (err) {
    return next(new AppError('Invalid or expired token', 401, 'TOKEN_INVALID'));
  }
}

module.exports = authMiddleware;
