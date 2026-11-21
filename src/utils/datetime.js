// Clinic times are LOCAL wall-clock times ("2026-12-01 09:30"), stored in
// MySQL DATETIME columns without a timezone. The server runs in the clinic's
// timezone, so a local JavaScript Date is the right representation.

// Accepts "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm", optionally with ":ss".
// Deliberately rejects timezone suffixes (Z, +02:00) — ambiguous for a clinic.
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses a local date-time string. Returns a Date, or null if the string is
 * malformed or names an impossible date/time (2026-02-30, 25:00, ...).
 */
function parseLocalDateTime(value) {
  if (typeof value !== 'string') return null;
  const m = LOCAL_DATETIME_RE.exec(value.trim());
  if (!m) return null;
  // Seconds are optional: an unmatched group is undefined → treat as 0.
  const [year, month, day, hour, minute, second] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
  const d = new Date(year, month - 1, day, hour, minute, second, 0);
  // Date silently rolls invalid values over (Feb 30 → Mar 2); detect that.
  if (
    d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day ||
    d.getHours() !== hour || d.getMinutes() !== minute || d.getSeconds() !== second
  ) {
    return null;
  }
  return d;
}

const pad = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD HH:MM:SS' (local), the format MySQL DATETIME expects. */
function toSqlDateTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Date → 'YYYY-MM-DD' (local). */
function toSqlDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = { parseLocalDateTime, toSqlDateTime, toSqlDate };
