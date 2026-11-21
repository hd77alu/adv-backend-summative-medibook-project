const { pool } = require('./db');

const COLUMNS = 'id, full_name, email, phone, created_at, updated_at';
// Column names that may appear in an UPDATE. Names come ONLY from this list
// (never from user input); values are always bound with ? placeholders.
const UPDATABLE = ['full_name', 'email', 'phone'];

async function findAll() {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM patients ORDER BY id`);
  return rows;
}

async function findById(id, conn = pool) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM patients WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function create({ full_name, email, phone }) {
  const [result] = await pool.execute(
    'INSERT INTO patients (full_name, email, phone) VALUES (?, ?, ?)',
    [full_name, email, phone],
  );
  return findById(result.insertId);
}

/** Updates the supplied fields; returns the updated row, or null if not found. */
async function update(id, fields) {
  const cols = UPDATABLE.filter((c) => fields[c] !== undefined);
  if (cols.length) {
    const setClause = cols.map((c) => `${c} = ?`).join(', ');
    const [result] = await pool.execute(
      `UPDATE patients SET ${setClause} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
    if (result.affectedRows === 0) return null;
  }
  return findById(id);
}

/** Returns true if a row was deleted. FK RESTRICT blocks patients with appointments. */
async function remove(id) {
  const [result] = await pool.execute('DELETE FROM patients WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function findAppointments(patientId) {
  const [rows] = await pool.execute(
    `SELECT a.id, a.doctor_id, d.full_name AS doctor_name, d.specialty, d.room,
            a.appt_datetime, a.amount_paid, a.status, a.booked_at,
            a.cancelled_at, a.refund_amount
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
      WHERE a.patient_id = ?
      ORDER BY a.appt_datetime DESC`,
    [patientId],
  );
  return rows;
}

module.exports = { findAll, findById, create, update, remove, findAppointments };
