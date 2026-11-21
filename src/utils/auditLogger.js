// Part D — append-only audit log (JSON Lines) using the async fs API.
//
// * Non-blocking: fs/promises only, no *Sync calls.
// * Creates the log directory on first write (mkdir -p semantics), once.
// * NEVER throws or rejects: a logging failure is reported to stderr and the
//   caller's request carries on. audit() always resolves to true/false.
// * One appendFile() call per entry, opened with the 'a' (O_APPEND) flag, so
//   each line is written whole even when the web server and the worker
//   append to the same file.
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');

// Relative paths resolve from the project root, so the web server and the
// worker always share the same file regardless of their working directory.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LOG_DIR = path.resolve(PROJECT_ROOT, config.auditLogDir);
const LOG_FILE = path.join(LOG_DIR, 'audit.log');

let dirReady = null; // memoised mkdir promise

function ensureLogDir() {
  if (!dirReady) {
    dirReady = fs.mkdir(LOG_DIR, { recursive: true }).catch((err) => {
      dirReady = null; // retry on the next write (e.g. permissions fixed)
      throw err;
    });
  }
  return dirReady;
}

/**
 * Appends one JSON line: {"timestamp": ..., "event": ..., ...data}
 * @param {string} event  e.g. 'APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED'
 * @param {object} data   event details
 * @returns {Promise<boolean>} true if written, false if logging failed
 */
async function audit(event, data = {}) {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...data }) + '\n';
    await ensureLogDir();
    await fs.appendFile(LOG_FILE, line, { encoding: 'utf8', flag: 'a' });
    return true;
  } catch (err) {
    console.error(`[audit] failed to write ${event}: ${err.message}`);
    return false;
  }
}

module.exports = { audit, LOG_FILE };
