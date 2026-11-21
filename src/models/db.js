// MySQL connection pool + transaction helper.
// This is the ONLY place a connection is created; all SQL lives in src/models/.
const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  // Return DATETIME/DATE as 'YYYY-MM-DD HH:MM:SS' strings — clinic wall-clock
  // time, no silent timezone conversion between MySQL and JavaScript.
  dateStrings: true,
  // Return DECIMAL/SUM/ROUND results as JS numbers (150.00 → 150) so JSON
  // responses are numeric. DECIMAL(10,2) values are exactly representable
  // for display purposes; arithmetic on money is done in integer cents.
  decimalNumbers: true,
});

/**
 * Runs `work(conn)` inside a single transaction on one pooled connection.
 * Commits if `work` resolves, rolls back if it throws (and re-throws).
 */
async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Connectivity check used at startup. */
async function ping() {
  await pool.query('SELECT 1');
}

module.exports = { pool, withTransaction, ping };
