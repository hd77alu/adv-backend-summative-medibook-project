const Report = require('../models/reportModel');
const { badRequest } = require('../utils/errors');
const { parseLocalDateTime } = require('../utils/datetime');
const { clinic } = require('../config');

/** GET /api/reports/doctors */
async function doctors(req, res) {
  const rows = await Report.doctorsReport();
  res.json({ data: rows, count: rows.length });
}

/** GET /api/reports/busy-days?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional) */
async function busyDays(req, res) {
  const errors = [];
  const range = {};
  for (const key of ['from', 'to']) {
    const v = req.query[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !parseLocalDateTime(`${v} 00:00`)) {
      errors.push({ field: key, message: `${key} must be a valid date in the format YYYY-MM-DD` });
    } else {
      range[key] = v;
    }
  }
  if (range.from && range.to && range.from > range.to) {
    errors.push({ field: 'from', message: 'from must be on or before to' });
  }
  if (errors.length) throw badRequest('Invalid query parameters', errors);

  const rows = await Report.busyDays(clinic.dailyCap, clinic.busyThreshold, range);
  res.json({
    criteria: `more than ${clinic.busyThreshold * 100}% of the ${clinic.dailyCap}-slot daily capacity booked`,
    data: rows,
    count: rows.length,
  });
}

module.exports = { doctors, busyDays };
