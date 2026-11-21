// Waitlist stored in Redis: one FIFO list per (doctor, date).
//
// Each multi-step change is a Lua script, which Redis runs atomically (no
// other command can interleave), so a patient is always in exactly one place:
//
//   waitlist ──claim──▶ pending ──finish──▶ (removed: booked or dropped)
//      ▲                   │
//      └─────requeue───────┘  (booking failed → back to the FRONT)
//
// If the worker crashes while an entry is in `pending`, recoverPending()
// puts it back at the front of its waitlist on the next start.
const crypto = require('crypto');
const { keys } = require('./redis');
const { isEligible } = require('./promotionPolicy');

const SCRIPTS = {
  // KEYS: list, members | ARGV: patient_id, entry, expireAtMs → position or -1 if already waiting
  waitlistJoin: {
    numberOfKeys: 2,
    lua: `
      if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return -1 end
      redis.call('SADD', KEYS[2], ARGV[1])
      local position = redis.call('RPUSH', KEYS[1], ARGV[2])
      redis.call('PEXPIREAT', KEYS[1], ARGV[3])
      redis.call('PEXPIREAT', KEYS[2], ARGV[3])
      return position`,
  },
  // KEYS: list, pending | ARGV: entry → 1 if claimed, 0 if it was no longer there
  waitlistClaim: {
    numberOfKeys: 2,
    lua: `
      if redis.call('LREM', KEYS[1], 1, ARGV[1]) == 1 then
        redis.call('RPUSH', KEYS[2], ARGV[1])
        return 1
      end
      return 0`,
  },
  // KEYS: pending, list | ARGV: entry — back to the FRONT of the waitlist
  waitlistRequeue: {
    numberOfKeys: 2,
    lua: `
      redis.call('LREM', KEYS[1], 1, ARGV[1])
      return redis.call('LPUSH', KEYS[2], ARGV[1])`,
  },
  // KEYS: pending, members | ARGV: entry, patient_id — outcome decided, remove for good
  waitlistFinish: {
    numberOfKeys: 2,
    lua: `
      redis.call('LREM', KEYS[1], 1, ARGV[1])
      return redis.call('SREM', KEYS[2], ARGV[2])`,
  },
};

const prepared = new WeakSet();
function withScripts(redis) {
  if (!prepared.has(redis)) {
    for (const [name, { numberOfKeys, lua }] of Object.entries(SCRIPTS)) {
      redis.defineCommand(name, { numberOfKeys, lua });
    }
    prepared.add(redis);
  }
  return redis;
}

/** Waitlist keys expire the day after the appointment date — stale entries clean themselves up. */
function expiryFor(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d + 2).getTime();
}

/**
 * Adds a patient to the end of the (doctor, date) waitlist.
 * @returns {Promise<{entry, position: number} | null>} null if already waiting
 */
async function join(redis, { patient_id, doctor_id, date, requested_datetime, any_slot }) {
  const entry = {
    id: crypto.randomUUID(),
    patient_id,
    doctor_id,
    date,
    requested_datetime,
    any_slot,
    joined_at: new Date().toISOString(),
  };
  const position = await withScripts(redis).waitlistJoin(
    keys.waitlist(doctor_id, date), keys.waitlistMembers(doctor_id, date),
    String(patient_id), JSON.stringify(entry), expiryFor(date),
  );
  return position === -1 ? null : { entry, position };
}

/** Current waitlist for a doctor/date, in order (position 1 = next in line). */
async function list(redis, doctorId, date) {
  const raw = await redis.lrange(keys.waitlist(doctorId, date), 0, -1);
  return raw.map((r, i) => ({ position: i + 1, ...JSON.parse(r) }));
}

/**
 * Atomically moves the FIRST entry eligible for `freedDatetime` from the
 * waitlist into `pending`. Returns { entry, raw } or null if nobody fits.
 */
async function claimFirstEligible(redis, doctorId, date, freedDatetime) {
  withScripts(redis);
  const listKey = keys.waitlist(doctorId, date);
  for (let attempt = 0; attempt < 5; attempt++) {
    const raws = await redis.lrange(listKey, 0, -1);
    const raw = raws.find((r) => {
      try { return isEligible(JSON.parse(r), freedDatetime); } catch { return false; }
    });
    if (!raw) return null;
    // Claim only succeeds if the entry is still in the list (nobody else took it).
    if (await redis.waitlistClaim(listKey, keys.waitlistPending(doctorId, date), raw)) {
      return { entry: JSON.parse(raw), raw };
    }
  }
  return null;
}

/** Booking failed for a reason that isn't the patient's fault: back to the front. */
async function requeueFront(redis, { entry, raw }) {
  return withScripts(redis).waitlistRequeue(
    keys.waitlistPending(entry.doctor_id, entry.date), keys.waitlist(entry.doctor_id, entry.date), raw,
  );
}

/** Outcome decided (booked, or permanently impossible): remove the entry for good. */
async function finish(redis, { entry, raw }) {
  return withScripts(redis).waitlistFinish(
    keys.waitlistPending(entry.doctor_id, entry.date), keys.waitlistMembers(entry.doctor_id, entry.date),
    raw, String(entry.patient_id),
  );
}

/**
 * Crash recovery (worker start-up): any entry left in a `pending` list was
 * mid-promotion when the worker died. Put it back at the FRONT of its
 * waitlist. Promotion is idempotent (the worker checks whether the patient
 * is already booked), so a retry can't double-book.
 */
async function recoverPending(redis) {
  let cursor = '0';
  let recovered = 0;
  do {
    const [next, pendingKeys] = await redis.scan(cursor, 'MATCH', keys.waitlistPendingPattern, 'COUNT', 100);
    cursor = next;
    for (const pendingKey of pendingKeys) {
      const listKey = pendingKey.replace(/:pending$/, '');
      while (await redis.lmove(pendingKey, listKey, 'RIGHT', 'LEFT')) recovered++;
    }
  } while (cursor !== '0');
  return recovered;
}

module.exports = { join, list, claimFirstEligible, requeueFront, finish, recoverPending };
