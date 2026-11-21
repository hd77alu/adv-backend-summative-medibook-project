// Reports: results are produced entirely by SQL (joins + aggregates),
// not computed in JavaScript.
const { pool } = require('./db');

/**
 * Every doctor's appointment totals and revenue, INCLUDING doctors with no
 * appointments: LEFT JOIN keeps them (a.* is NULL → COUNT(a.id) = 0,
 * COALESCE(SUM(...), 0) = 0.00).
 *  - total_appointments:     active bookings (cancelled ones excluded)
 *  - cancelled_appointments: cancellations kept for refund history
 *  - revenue_collected:      amount_paid − refund_amount over all rows
 */
async function doctorsReport() {
  const [rows] = await pool.query(
    `SELECT d.id AS doctor_id, d.full_name, d.specialty, d.consultation_fee,
            COUNT(CASE WHEN a.status = 'booked'    THEN 1 END) AS total_appointments,
            COUNT(CASE WHEN a.status = 'cancelled' THEN 1 END) AS cancelled_appointments,
            COALESCE(SUM(a.amount_paid), 0)                     AS gross_paid,
            COALESCE(SUM(a.refund_amount), 0)                   AS total_refunded,
            COALESCE(SUM(a.amount_paid - COALESCE(a.refund_amount, 0)), 0) AS revenue_collected
       FROM doctors d
       LEFT JOIN appointments a ON a.doctor_id = d.id
      GROUP BY d.id, d.full_name, d.specialty, d.consultation_fee
      ORDER BY revenue_collected DESC, d.full_name`,
  );
  return rows;
}

/**
 * Every (doctor, date) where active bookings exceed `threshold` (0.8) of the
 * daily cap — i.e. more than 9.6 of 12, so 10, 11 or 12 bookings.
 * Optional from/to ('YYYY-MM-DD') narrow the date range.
 */
async function busyDays(dailyCap, threshold, { from = null, to = null } = {}) {
  const [rows] = await pool.execute(
    `SELECT d.id AS doctor_id, d.full_name, d.specialty,
            DATE_FORMAT(a.appt_date, '%Y-%m-%d') AS date,
            COUNT(*) AS booked_slots,
            ? AS daily_capacity,
            ROUND(100 * COUNT(*) / ?, 1) AS utilization_pct
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
      WHERE a.status = 'booked'
        AND (? IS NULL OR a.appt_date >= ?)
        AND (? IS NULL OR a.appt_date <= ?)
      GROUP BY d.id, d.full_name, d.specialty, a.appt_date
     HAVING COUNT(*) > ? * ?
      ORDER BY a.appt_date, utilization_pct DESC, d.full_name`,
    [dailyCap, dailyCap, from, from, to, to, dailyCap, threshold],
  );
  return rows;
}

module.exports = { doctorsReport, busyDays };
