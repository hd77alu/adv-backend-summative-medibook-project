// Application errors carry their HTTP status so the central error handler
// can respond consistently. Controllers/services throw these; they never
// write error responses themselves.
class AppError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, message, { code: 'VALIDATION_ERROR', details });
const notFound = (message, code = 'NOT_FOUND') => new AppError(404, message, { code });
const conflict = (message, code = 'CONFLICT', details) => new AppError(409, message, { code, details });
const unprocessable = (message, code = 'BUSINESS_RULE_VIOLATION', details) =>
  new AppError(422, message, { code, details });

module.exports = { AppError, badRequest, notFound, conflict, unprocessable };
