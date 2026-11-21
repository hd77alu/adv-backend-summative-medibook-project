const { parseId } = require('../validators');
const { badRequest } = require('../utils/errors');

/** Parses :id (or another param) as a positive integer or throws 400. */
function requireId(req, param = 'id') {
  const id = parseId(req.params[param]);
  if (!id) throw badRequest(`${param} must be a positive integer`, [{ field: param, message: `got "${req.params[param]}"` }]);
  return id;
}

/** Throws a 400 listing every validation problem, if there are any. */
function assertValid({ errors }) {
  if (errors.length) throw badRequest('Validation failed', errors);
}

module.exports = { requireId, assertValid };
