/**
 * Unified API response helpers
 */

function success(res, data, options) {
  let status = 200;
  let meta;

  if (typeof options === 'number') {
    status = options;
  } else if (options) {
    status = options.status || status;
    meta = options.meta;
  }

  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}

function error(res, message, code = 'ERROR', status = 400) {
  return res.status(status).json({
    success: false,
    error: { code, message }
  });
}

function notFound(res, message = '资源不存在') {
  return error(res, message, 'NOT_FOUND', 404);
}

function validationError(res, message) {
  return error(res, message, 'VALIDATION_ERROR', 422);
}

function serverError(res, message = '服务器内部错误') {
  return error(res, message, 'SERVER_ERROR', 500);
}

module.exports = { success, error, notFound, validationError, serverError };
