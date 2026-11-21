// Central error handling. Every error thrown in a route, controller, service
// or model ends up here (Express 5 forwards rejected async handlers), so all
// error responses share one shape:
//   { "error": { "status": 409, "code": "SLOT_TAKEN", "message": "...", "details": ... } }
const { AppError } = require('../utils/errors');

// MySQL errors that mean "the client did something wrong", not a server fault.
function fromMysqlError(err) {
  switch (err.code) {
    case 'ER_DUP_ENTRY': {
      const field = /for key '(?:\w+\.)?uq_\w+?_(\w+)'/.exec(err.sqlMessage || '')?.[1];
      return new AppError(409, field ? `A record with this ${field} already exists` : 'Duplicate record', { code: 'DUPLICATE' });
    }
    case 'ER_ROW_IS_REFERENCED_2':
    case 'ER_ROW_IS_REFERENCED':
      return new AppError(409, 'Cannot delete: this record has appointment history, which is kept for refund and audit purposes', { code: 'HAS_APPOINTMENTS' });
    case 'ER_NO_REFERENCED_ROW_2':
      return new AppError(404, 'Referenced patient or doctor does not exist', { code: 'NOT_FOUND' });
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return new AppError(422, `Business rule violated: ${err.sqlMessage}`, { code: 'CONSTRAINT_VIOLATION' });
    case 'ER_DATA_TOO_LONG':
    case 'ER_TRUNCATED_WRONG_VALUE':
    case 'ER_WARN_DATA_OUT_OF_RANGE':
      return new AppError(400, 'A value is too long or out of range', { code: 'VALIDATION_ERROR' });
    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let appErr = err instanceof AppError ? err : fromMysqlError(err);

  // Malformed JSON body (from express.json()).
  if (!appErr && err.type === 'entity.parse.failed') {
    appErr = new AppError(400, 'Request body is not valid JSON', { code: 'INVALID_JSON' });
  }
  if (!appErr && err.type === 'entity.too.large') {
    appErr = new AppError(413, 'Request body too large', { code: 'PAYLOAD_TOO_LARGE' });
  }

  if (!appErr) {
    // Unexpected error: log the full error server-side, but never leak
    // stack traces or SQL to the client.
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    const dbDown = ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(err.code);
    appErr = dbDown
      ? new AppError(503, 'Database unavailable', { code: 'SERVICE_UNAVAILABLE' })
      : new AppError(500, 'Internal server error', { code: 'INTERNAL_ERROR' });
  }

  const body = { status: appErr.status, code: appErr.code, message: appErr.message };
  if (appErr.details !== undefined) body.details = appErr.details;
  res.status(appErr.status).json({ error: body });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { status: 404, code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
}

module.exports = { errorHandler, notFoundHandler };
