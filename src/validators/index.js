// Pure request validators. Each returns { value, errors } where errors is an
// array of { field, message }. Controllers turn non-empty errors into a 400.
// Rules mirror the CHECK constraints in database/schema.sql so bad input is
// rejected with a helpful message before it ever reaches MySQL.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9 -]{6,18}$/;     // same as chk_*_phone
const MONEY_RE = /^\d{1,8}(\.\d{1,2})?$/;      // fits DECIMAL(10,2)

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Positive integer id from a route param or body field. */
function parseId(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 && raw <= 4294967295 ? raw : null;
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 4294967295 ? n : null;       // INT UNSIGNED max
}

function stringField(body, field, max, errors, { label = field } = {}) {
  const v = body[field];
  if (typeof v !== 'string' || v.trim() === '') {
    errors.push({ field, message: `${label} is required and must be a non-empty string` });
    return undefined;
  }
  const t = v.trim();
  if (t.length > max) errors.push({ field, message: `${label} must be at most ${max} characters` });
  return t;
}

function emailField(body, errors) {
  const v = stringField(body, 'email', 255, errors);
  if (v !== undefined && !EMAIL_RE.test(v)) errors.push({ field: 'email', message: 'email must be a valid email address' });
  return v?.toLowerCase();
}

/**
 * Generic entity validator.
 * partial=false (POST/PUT): every field required.
 * partial=true  (PATCH):    only supplied fields validated; at least one required.
 */
function validateEntity(body, fields, { partial }) {
  const errors = [];
  if (!isObject(body)) return { value: {}, errors: [{ field: null, message: 'Request body must be a JSON object' }] };

  const allowed = Object.keys(fields);
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) errors.push({ field: unknown.join(', '), message: `Unknown field(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}` });

  const value = {};
  for (const [field, check] of Object.entries(fields)) {
    if (partial && body[field] === undefined) continue;
    const v = check(body, errors);
    if (v !== undefined) value[field] = v;
  }
  if (partial && Object.keys(body).filter((k) => allowed.includes(k)).length === 0) {
    errors.push({ field: null, message: `Provide at least one of: ${allowed.join(', ')}` });
  }
  return { value, errors };
}

const patientFields = {
  full_name: (b, e) => stringField(b, 'full_name', 100, e),
  email: (b, e) => emailField(b, e),
  phone: (b, e) => {
    const v = stringField(b, 'phone', 20, e);
    if (v !== undefined && !PHONE_RE.test(v)) e.push({ field: 'phone', message: 'phone must contain 7–19 digits, spaces or dashes, optionally starting with +' });
    return v;
  },
};

const doctorFields = {
  full_name: (b, e) => stringField(b, 'full_name', 100, e),
  email: (b, e) => emailField(b, e),
  specialty: (b, e) => stringField(b, 'specialty', 100, e),
  consultation_fee: (b, e) => {
    const v = b.consultation_fee;
    const s = typeof v === 'number' ? String(v) : v;
    if ((typeof v !== 'number' && typeof v !== 'string') || !MONEY_RE.test(String(s).trim())) {
      e.push({ field: 'consultation_fee', message: 'consultation_fee must be a non-negative amount with at most 2 decimals (e.g. 150 or 150.00)' });
      return undefined;
    }
    return Number(s).toFixed(2);
  },
  room: (b, e) => stringField(b, 'room', 10, e),
};

const validatePatient = (body, opts = { partial: false }) => validateEntity(body, patientFields, opts);
const validateDoctor = (body, opts = { partial: false }) => validateEntity(body, doctorFields, opts);

/** Booking body shape only — slot rules live in utils/slot.js. */
function validateBooking(body) {
  const errors = [];
  if (!isObject(body)) return { value: {}, errors: [{ field: null, message: 'Request body must be a JSON object' }] };
  const patient_id = parseId(body.patient_id);
  const doctor_id = parseId(body.doctor_id);
  if (!patient_id) errors.push({ field: 'patient_id', message: 'patient_id is required and must be a positive integer' });
  if (!doctor_id) errors.push({ field: 'doctor_id', message: 'doctor_id is required and must be a positive integer' });
  if (typeof body.appt_datetime !== 'string' || body.appt_datetime.trim() === '') {
    errors.push({ field: 'appt_datetime', message: 'appt_datetime is required, e.g. "2026-12-01 09:30"' });
  }
  return { value: { patient_id, doctor_id, appt_datetime: body.appt_datetime }, errors };
}

module.exports = { parseId, validatePatient, validateDoctor, validateBooking };
