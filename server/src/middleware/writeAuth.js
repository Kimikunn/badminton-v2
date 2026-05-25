const crypto = require('node:crypto');
const config = require('../config/config');
const { error } = require('../utils/response');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getRequestToken(req) {
  const headerToken = req.get('x-admin-token');
  if (headerToken) return headerToken;

  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function tokenMatches(input, expected) {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);
  if (inputBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(inputBuffer, expectedBuffer);
}

function requireWriteAuth(req, res, next) {
  const adminToken = config.auth.adminToken;
  if (!adminToken || !WRITE_METHODS.has(req.method)) return next();

  const token = getRequestToken(req);
  if (!token) return error(res, '缺少写入权限令牌', 'UNAUTHORIZED', 401);
  if (!tokenMatches(token, adminToken)) return error(res, '写入权限令牌无效', 'FORBIDDEN', 403);

  return next();
}

module.exports = {
  requireWriteAuth
};
