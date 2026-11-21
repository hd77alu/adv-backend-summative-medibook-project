const { pool } = require('./db');

const DETAIL_SELECT = `
  SELECT a.id, a.patient_id, p.full_name AS patient_name, p.email AS patient_email,
         a.doctor_id, d.full_name AS doctor_name, d.specialty, d.room,
         a.appt_datetime, a.amount_paid, a.status, a.booked_at,
         a.cancelled_at, a.refund_amount
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN doctors  d ON d.id = a.doctor_id`;

async function findById(id, conn = pool) {
  const [rows] = await conn.execute(`${DETAIL_SELECT} WHERE a.id = ?`, [id]);
  return rows[0] || null;
}

/** Locks one appointment row for the rest of the transaction (cancellation). */
async function lockById(conn, id) {
  const [rows] = await conn.execute(
    `SELECT id, patient_id, doctor_id, appt_datetime, amount_paid, status
       FROM appointments WHERE id = ? FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

/** Active (non-cancelled) bookings a doctor has on a given date. */
async function countBookedOnDay(conn, doctorId, date) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS total FROM appointments
      WHERE doctor_id = ? AND appt_date = ? AND status = 'booked'`,
    [doctorId, date],
  );
  return Number(rows[0].total);
}

/** Is this exact doctor slot already actively booked? */
async function isSlotTaken(conn, doctorId, datetime) {
  const [rows] = await conn.execute(
    `SELECT id FROM appointments
      WHERE doctor_id = ? AND appt_datetime = ? AND status = 'booked'
      LIMIT 1`,
    [doctorId, datetime],
  );
  return rows.length > 0;
}

/**
 * Inserts a booking. If a concurrent request slipped past the checks, the
 * uq_appointments_doctor_slot index rejects it with ER_DUP_ENTRY.
 */
async function create(conn, { patient_id, doctor_id, appt_datetime, amount_paid }) {
  const [result] = await conn.execute(
    `INSERT INTO appointments (patient_id, doctor_id, appt_datetime, amount_paid)
     VALUES (?, ?, ?, ?)`,
    [patient_id, doctor_id, appt_datetime, amount_paid],
  );
  return result.insertId;
}

/**
 * Cancellation + refund record in ONE statement: status, cancelled_at and
 * refund_amount change together or not at all (chk_appt_cancel_record also
 * forbids a half-written record). Setting status='cancelled' turns
 * active_slot to NULL, which frees the slot in the unique index.
 * The status guard makes a double-cancel a no-op (affectedRows = 0).
 */
async function markCancelled(conn, id, cancelledAt, refundAmount) {
  const [result] = await conn.execute(
    `UPDATE appointments
        SET status = 'cancelled', cancelled_at = ?, refund_amount = ?
      WHERE id = ? AND status = 'booked'`,
    [cancelledAt, refundAmount, id],
  );
  return result.affectedRows === 1;
}

module.exports = { findById, lockById, countBookedOnDay, isSlotTaken, create, markCancelled };
