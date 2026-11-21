// Minimal reliable job queue on Redis lists.
//
//   producer ─RPUSH─▶ queue ─BLMOVE─▶ queue:processing ─(success) LREM─▶ done
//                       ▲                    │
//                       └──── retry ─────────┤ (failure, attempts < max)
//                                            └──▶ queue:failed (dead letters)
//
// BLMOVE atomically moves a job into the processing list as it's taken, so
// a job is never "in flight" only in the worker's memory: if the worker dies,
// recover() moves unfinished jobs back onto the queue at start-up.
const crypto = require('crypto');
const { keys } = require('./redis');

async function enqueue(redis, queue, type, payload) {
  const job = { id: crypto.randomUUID(), type, payload, attempts: 0, enqueued_at: new Date().toISOString() };
  await redis.rpush(queue, JSON.stringify(job));
  return job;
}

/** Blocks up to `timeoutSec` for the next job. Returns { raw, job } or null. */
async function reserve(blockingRedis, queue, timeoutSec) {
  const raw = await blockingRedis.blmove(queue, keys.processing(queue), 'LEFT', 'RIGHT', timeoutSec);
  if (!raw) return null;
  try {
    return { raw, job: JSON.parse(raw) };
  } catch {
    return { raw, job: null }; // unreadable job: the worker will dead-letter it
  }
}

/** Job finished: remove it from processing. */
async function ack(redis, queue, raw) {
  await redis.lrem(keys.processing(queue), 1, raw);
}

/**
 * Job failed: put it back on the queue with attempts+1, or move it to the
 * dead-letter list once maxAttempts is reached. Atomic (MULTI).
 * @returns {'retried'|'dead-lettered'}
 */
async function fail(redis, queue, raw, job, err, maxAttempts) {
  const attempts = (job?.attempts ?? 0) + 1;
  const updated = JSON.stringify({ ...(job || { raw }), attempts, last_error: err.message, failed_at: new Date().toISOString() });
  const dead = attempts >= maxAttempts || !job;
  await redis.multi()
    .lrem(keys.processing(queue), 1, raw)
    .rpush(dead ? keys.failed(queue) : queue, updated)
    .exec();
  return dead ? 'dead-lettered' : 'retried';
}

/** Start-up recovery: move jobs a crashed worker left in processing back to the front of the queue. */
async function recover(redis, queue) {
  let n = 0;
  while (await redis.lmove(keys.processing(queue), queue, 'RIGHT', 'LEFT')) n++;
  return n;
}

module.exports = { enqueue, reserve, ack, fail, recover };
