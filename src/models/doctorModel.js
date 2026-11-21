const { pool } = require('./db');

const COLUMNS = 'id, full_name, email, specialty, consultation_fee, room, created_at, updated_at';
// Whitelisted column names for UPDATE; values always bound with ?.
const UPDATABLE = ['full_name', 'email', 'specialty', 'consultation_fee', 'room'];

async function findAll() {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM doctors ORDER BY id`);
  return rows;
}

async function findById(id, conn = pool) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM doctors WHERE id = ?`, [id]);
  return rows[0] || null;
}

/**
 * Reads the doctor row with an exclusive lock (inside a transaction).
 * Every booking for a doctor takes this lock first, so concurrent bookings
 * for the SAME doctor are serialised: the daily-cap count and slot check
 * that follow cannot be invalidated by a parallel request.
 */
async function lockById(conn, id) {
  const [rows] = await conn.execute(
    'SELECT id, full_name, consultation_fee FROM doctors WHERE id = ? FOR UPDATE',
    [id],
  );
  return rows[0] || null;
}

async function create({ full_name, email, specialty, consultation_fee, room }) {
  const [result] = await pool.execute(
    `INSERT INTO doctors (full_name, email, specialty, consultation_fee, room)
     VALUES (?, ?, ?, ?, ?)`,
    [full_name, email, specialty, consultation_fee, room],
  );
  return findById(result.insertId);
}

async function update(id, fields) {
  const cols = UPDATABLE.filter((c) => fields[c] !== undefined);
  if (cols.length) {
    const setClause = cols.map((c) => `${c} = ?`).join(', ');
    const [result] = await pool.execute(
      `UPDATE doctors SET ${setClause} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
    if (result.affectedRows === 0) return null;
  }
  return findById(id);
}

async function remove(id) {
  const [result] = await pool.execute('DELETE FROM doctors WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

/**
 * Headline statistics for one doctor, computed entirely in SQL.
 *  - revenue_collected: money kept = amount_paid − refund_amount (all time)
 *  - upcoming_appointments: active bookings that start after now
 *  - booked_next_7_days / utilization_pct: active bookings from today to
 *    today+6 against capacity (7 × daily cap)
 * Returns null if the doctor does not exist.
 */
async function getStats(doctorId, dailyCap) {
  const [rows] = await pool.execute(
    `SELECT d.id AS doctor_id, d.full_name, d.specialty,
            COALESCE(SUM(a.amount_paid - COALESCE(a.refund_amount, 0)), 0) AS revenue_collected,
            COUNT(CASE WHEN a.status = 'booked' AND a.appt_datetime > NOW() THEN 1 END)
              AS upcoming_appointments,
            COUNT(CASE WHEN a.status = 'booked'
                        AND a.appt_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 6 DAY
                       THEN 1 END) AS booked_next_7_days,
            ROUND(100 * COUNT(CASE WHEN a.status = 'booked'
                                    AND a.appt_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 6 DAY
                                   THEN 1 END) / (7 * ?), 1) AS utilization_pct
       FROM doctors d
       LEFT JOIN appointments a ON a.doctor_id = d.id
      WHERE d.id = ?
      GROUP BY d.id, d.full_name, d.specialty`,
    [dailyCap, doctorId],
  );
  return rows[0] || null;
}

/**
 * Appointments per day for the next 7 days (today .. today+6), INCLUDING
 * days with zero bookings — a recursive CTE generates the 7 dates and the
 * appointments are LEFT JOINed onto them.
 */
async function getDailyLoad(doctorId, dailyCap) {
  const [rows] = await pool.execute(
    `WITH RECURSIVE days (cal_date, n) AS (
         SELECT CURDATE(), 0
         UNION ALL
         SELECT cal_date + INTERVAL 1 DAY, n + 1 FROM days WHERE n < 6
     )
     SELECT DATE_FORMAT(days.cal_date, '%Y-%m-%d') AS date,
            COUNT(a.id) AS appointments,
            ROUND(100 * COUNT(a.id) / ?, 1) AS utilization_pct
       FROM days
       LEFT JOIN appointments a
              ON a.doctor_id = ? AND a.appt_date = days.cal_date AND a.status = 'booked'
      GROUP BY days.cal_date
      ORDER BY days.cal_date`,
    [dailyCap, doctorId],
  );
  return rows;
}

module.exports = { findAll, findById, lockById, create, update, remove, getStats, getDailyLoad };
