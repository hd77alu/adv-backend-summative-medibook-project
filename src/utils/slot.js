// Pure slot validation (no DB) — unit-tested in Part F.
const { parseLocalDateTime, toSqlDateTime, toSqlDate } = require('./datetime');
const { clinic } = require('../config');

/**
 * Checks that `value` is a bookable appointment start time.
 *
 * Rules (in order):
 *   MALFORMED     — not a valid "YYYY-MM-DD HH:mm[:ss]" local date-time
 *   NOT_ON_SLOT   — minutes not :00/:30, or seconds not 0 (09:15, 09:30:10)
 *   OUTSIDE_HOURS — before 09:00, or starting at/after 17:00. The clinic
 *                   closes at 17:00, so the last 30-min slot starts at 16:30;
 *                   17:00 itself is rejected.
 *   IN_PAST       — not strictly after `now`
 *
 * @returns {{ok: true, start: Date, datetime: string, date: string}
 *          | {ok: false, reason: string, message: string}}
 */
function validateSlot(value, now = new Date(), rules = clinic) {
  const start = parseLocalDateTime(value);
  if (!start) {
    return fail('MALFORMED', 'appt_datetime must be a valid local date-time in the format "YYYY-MM-DD HH:mm" (e.g. "2026-12-01 09:30")');
  }

  if (start.getMinutes() % rules.slotMinutes !== 0 || start.getSeconds() !== 0) {
    return fail('NOT_ON_SLOT', `Appointments start on ${rules.slotMinutes}-minute boundaries (e.g. 09:00, 09:30)`);
  }

  const minutesOfDay = start.getHours() * 60 + start.getMinutes();
  const firstSlot = rules.openHour * 60;
  const lastSlot = rules.closeHour * 60 - rules.slotMinutes;
  if (minutesOfDay < firstSlot || minutesOfDay > lastSlot) {
    return fail('OUTSIDE_HOURS', `Appointments must be within working hours: the first slot is ${hhmm(firstSlot)} and the last is ${hhmm(lastSlot)}`);
  }

  if (start.getTime() <= now.getTime()) {
    return fail('IN_PAST', 'Appointments can only be booked in the future');
  }

  return { ok: true, start, datetime: toSqlDateTime(start), date: toSqlDate(start) };
}

function fail(reason, message) {
  return { ok: false, reason, message };
}

function hhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

module.exports = { validateSlot };
