// Redis connections and key names.
const Redis = require('ioredis');
const config = require('../config');

const PREFIX = 'medibook';

const keys = {
  // Waitlist for one doctor on one date: a list (FIFO) of JSON entries.
  waitlist: (doctorId, date) => `${PREFIX}:waitlist:${doctorId}:${date}`,
  // Entries being promoted right now (moved here atomically, removed only
  // when the outcome is decided — so a crash can never lose a patient).
  waitlistPending: (doctorId, date) => `${PREFIX}:waitlist:${doctorId}:${date}:pending`,
  // Set of patient ids on that waitlist (prevents joining twice).
  waitlistMembers: (doctorId, date) => `${PREFIX}:waitlist:${doctorId}:${date}:members`,
  waitlistPendingPattern: `${PREFIX}:waitlist:*:pending`,

  // Job queues (reliable-queue pattern): <queue>, <queue>:processing, <queue>:failed
  promotions: `${PREFIX}:queue:promotions`,
  notifications: `${PREFIX}:queue:notifications`,
  processing: (queue) => `${queue}:processing`,
  failed: (queue) => `${queue}:failed`,
};

/**
 * @param {'web'|'worker'} role
 *  web:    fail fast — if Redis is down, commands reject immediately instead
 *          of queueing in memory, so an HTTP request never hangs on Redis.
 *  worker: wait/retry forever (required for blocking commands like BLMOVE).
 */
function createRedis(role) {
  const options = role === 'web'
    ? { enableOfflineQueue: false, maxRetriesPerRequest: 1 }
    : { maxRetriesPerRequest: null };
  const client = new Redis(config.redisUrl, options);

  let lastLogged = 0;
  client.on('error', (err) => {
    // ioredis reconnects by itself; log at most every 30 s instead of flooding.
    if (Date.now() - lastLogged > 30000) {
      lastLogged = Date.now();
      console.error(`[redis:${role}] ${err.code || err.message} (${config.redisUrl}) — retrying`);
    }
  });
  return client;
}

module.exports = { createRedis, keys };
