require('dotenv').config({ quiet: true });

module.exports = {
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'medibook',
  },
  auditLogDir: process.env.AUDIT_LOG_DIR || 'logs',

  // Clinic business rules (single source of truth for API + SQL params).
  clinic: {
    dailyCap: 12,          // max appointments per doctor per day
    openHour: 9,           // first slot 09:00
    closeHour: 17,         // clinic closes 17:00 → last slot starts 16:30
    slotMinutes: 30,
    busyThreshold: 0.8,    // busy-days report: > 80% of dailyCap
  },
};
