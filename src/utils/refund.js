// Pure refund calculator (no DB) — unit-tested in Part F.
//
// Documented policy, by notice = appointment start − cancellation time:
//   notice  > 48 h            → 100 %
//   24 h <= notice <= 48 h    →  50 %   (both boundaries belong to the middle tier:
//                                        exactly 48 h → 50 %, exactly 24 h → 50 %)
//   notice  < 24 h            →   0 %
// Notice is compared in whole milliseconds, so there is no floating-point
// fuzz at the boundaries.

const HOUR_MS = 60 * 60 * 1000;

function refundPercentage(noticeMs) {
  if (noticeMs > 48 * HOUR_MS) return 100;
  if (noticeMs >= 24 * HOUR_MS) return 50;
  return 0;
}

/**
 * @param {string|number} amountPaid  e.g. 150 or '150.00'
 * @param {Date} appointmentStart
 * @param {Date} cancelledAt
 * @returns {{ percentage: number, amount: number, noticeHours: number }}
 *   amount is rounded to cents (e.g. 75 or 62.5), ready for DECIMAL(10,2).
 */
function calculateRefund(amountPaid, appointmentStart, cancelledAt) {
  const paid = Number(amountPaid);
  if (!Number.isFinite(paid) || paid < 0) throw new TypeError('amountPaid must be a non-negative number');
  if (!(appointmentStart instanceof Date) || Number.isNaN(appointmentStart.getTime()) ||
      !(cancelledAt instanceof Date) || Number.isNaN(cancelledAt.getTime())) {
    throw new TypeError('appointmentStart and cancelledAt must be valid Dates');
  }

  const noticeMs = appointmentStart.getTime() - cancelledAt.getTime();
  const percentage = refundPercentage(noticeMs);

  // Work in integer cents to avoid 0.1 + 0.2 style errors; round half up.
  const paidCents = Math.round(paid * 100);
  const refundCents = Math.round((paidCents * percentage) / 100);

  return {
    percentage,
    amount: refundCents / 100,
    noticeHours: Math.round((noticeMs / HOUR_MS) * 100) / 100,
  };
}

module.exports = { calculateRefund, refundPercentage, HOUR_MS };
