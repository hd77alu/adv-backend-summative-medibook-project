// Part E worker — a SEPARATE process from the web server:  npm run worker
//
// Consumes two Redis queues, each on its own blocking connection:
//   1. promotions    — a cancellation freed a slot: book the first eligible
//                      waitlisted patient into it.
//   2. notifications — "send" a confirmation SMS/email by writing it to the
//                      audit log (no real sending).
const config = require('./config');
const { createRedis, keys } = require('./queue/redis');
const jobQueue = require('./queue/jobQueue');
const waitlist = require('./queue/waitlist');
const { classifyPromotionFailure } = require('./queue/promotionPolicy');
const appointmentService = require('./services/appointmentService');
const Appointment = require('./models/appointmentModel');
const { pool } = require('./models/db');
const { audit } = require('./utils/auditLogger');

const redis = createRedis('worker');   // regular commands
let running = true;

const log = (...args) => console.log(new Date().toISOString(), '[worker]', ...args);

// ---------------------------------------------------------------------------
// Notification jobs
// ---------------------------------------------------------------------------
async function handleNotification(job) {
  const p = job.payload;
  const message = `Hi ${p.patient_name}, your appointment with ${p.doctor_name} is confirmed for ` +
    `${p.appt_datetime.slice(0, 16)} in room ${p.room}. Ref #${p.appointment_id}.`;
  const written = await audit('NOTIFICATION_SENT', {
    job_id: job.id,
    channel: 'sms+email',
    to: p.patient_email,
    appointment_id: p.appointment_id,
    source: p.source,
    message,
  });
  // The "sending" IS the log write, so a failed write is a failed job → retried.
  if (!written) throw new Error('could not write notification to audit log');
  log(`notification sent for appointment #${p.appointment_id}`);
}

// ---------------------------------------------------------------------------
// Waitlist promotion jobs
// ---------------------------------------------------------------------------
async function handlePromotion(job) {
  const { doctor_id, date, appt_datetime, cancelled_appointment_id } = job.payload;

  // Loop because a DROPPED entry (patient deleted) lets us try the next person.
  for (;;) {
    const claimed = await waitlist.claimFirstEligible(redis, doctor_id, date, appt_datetime);
    if (!claimed) {
      log(`slot ${appt_datetime} (doctor ${doctor_id}) freed — no eligible patient waiting`);
      return;
    }
    const { entry } = claimed;

    // Idempotency: if the patient already holds a booking with this doctor that
    // day (e.g. we crashed after booking but before finish()), don't book again.
    const existing = await Appointment.findActiveForPatientOnDay(entry.patient_id, doctor_id, date);
    if (existing) {
      await waitlist.finish(redis, claimed);
      await audit('WAITLIST_ENTRY_REMOVED', { reason: 'ALREADY_BOOKED', entry, appointment_id: existing.id });
      continue;
    }

    try {
      const appointment = await appointmentService.bookAppointment({
        patient_id: entry.patient_id, doctor_id, appt_datetime,
      });

      // Booked: the waitlist entry can now be removed for good.
      await waitlist.finish(redis, claimed);
      await audit('APPOINTMENT_BOOKED', {
        source: 'waitlist',
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        doctor_id: appointment.doctor_id,
        appt_datetime: appointment.appt_datetime,
        amount_paid: appointment.amount_paid,
        waitlist_entry_id: entry.id,
        freed_by_appointment_id: cancelled_appointment_id,
      });
      await jobQueue.enqueue(redis, keys.notifications, 'APPOINTMENT_CONFIRMATION', {
        source: 'waitlist',
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        patient_name: appointment.patient_name,
        patient_email: appointment.patient_email,
        doctor_name: appointment.doctor_name,
        room: appointment.room,
        appt_datetime: appointment.appt_datetime,
      });
      log(`promoted patient ${entry.patient_id} into ${appt_datetime} (appointment #${appointment.id})`);
      return;
    } catch (err) {
      const action = classifyPromotionFailure(err);

      if (action === 'DROP') {
        await waitlist.finish(redis, claimed);
        await audit('WAITLIST_ENTRY_REMOVED', { reason: err.code, message: err.message, entry });
        log(`dropped waitlist entry for patient ${entry.patient_id}: ${err.message}`);
        continue; // offer the slot to the next person
      }

      // In both remaining cases the patient goes back to the FRONT, keeping their place.
      await waitlist.requeueFront(redis, claimed);

      if (action === 'SLOT_UNAVAILABLE') {
        await audit('WAITLIST_PROMOTION_SKIPPED', { reason: err.code, message: err.message, entry, appt_datetime });
        log(`slot ${appt_datetime} no longer available (${err.code}); patient ${entry.patient_id} kept at front`);
        return;
      }

      throw err; // RETRY: transient failure → jobQueue.fail() re-queues the job
    }
  }
}

// ---------------------------------------------------------------------------
// Consumer loop (one per queue, each with its own blocking connection)
// ---------------------------------------------------------------------------
async function consume(queue, handler) {
  const blocking = redis.duplicate();
  blocking.on('error', () => {}); // errors already reported by the main connection
  while (running) {
    let reserved;
    try {
      reserved = await jobQueue.reserve(blocking, queue, config.worker.blockSeconds);
    } catch (err) {
      if (running) await sleep(1000);
      continue;
    }
    if (!reserved) continue;

    const { raw, job } = reserved;
    try {
      if (!job) throw new Error('unreadable job payload');
      await handler(job);
      await jobQueue.ack(redis, queue, raw);
    } catch (err) {
      const outcome = await jobQueue.fail(redis, queue, raw, job, err, config.worker.maxAttempts);
      log(`job ${job?.id} on ${queue} failed (${err.message}) → ${outcome}`);
      if (outcome === 'dead-lettered') {
        await audit('JOB_DEAD_LETTERED', { queue, job_id: job?.id, type: job?.type, error: err.message });
      } else {
        await sleep(1000 * ((job?.attempts ?? 0) + 1)); // simple linear back-off
      }
    }
  }
  blocking.disconnect();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log(`connecting to Redis at ${config.redisUrl} …`);
  await redis.ping();
  // Crash recovery before taking new work.
  const jobs = (await jobQueue.recover(redis, keys.promotions)) + (await jobQueue.recover(redis, keys.notifications));
  const entries = await waitlist.recoverPending(redis);
  log(`started (redis ${config.redisUrl}); recovered ${jobs} job(s), ${entries} pending waitlist entr(y/ies)`);

  const loops = [consume(keys.promotions, handlePromotion), consume(keys.notifications, handleNotification)];

  const shutdown = () => {
    if (!running) return;
    log('shutting down — finishing current jobs…');
    running = false;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await Promise.all(loops);
  await redis.quit();
  await pool.end();
  log('stopped');
}

main().catch((err) => {
  console.error('[worker] fatal:', err.message);
  process.exit(1);
});
