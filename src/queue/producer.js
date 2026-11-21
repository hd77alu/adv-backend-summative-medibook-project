// Web-server side of the queues: one shared fail-fast Redis connection.
//
// enqueue*() functions never throw — like the audit log, a queue problem
// must not fail a booking or cancellation that has already been committed.
// They resolve true/false and log failures.
const { createRedis, keys } = require('./redis');
const { enqueue } = require('./jobQueue');

let client = null;
function getRedis() {
  if (!client) client = createRedis('web');
  return client;
}

/**
 * The connection fails fast (no offline queue), so a command sent while it
 * is still connecting — e.g. the first request after start-up — would be
 * rejected. Wait briefly for 'ready'; if Redis is really down, give up
 * after `timeoutMs` so a request never hangs.
 */
function getReadyRedis(timeoutMs = 1000) {
  const c = getRedis();
  if (c.status === 'ready') return Promise.resolve(c);
  return new Promise((resolve, reject) => {
    const onReady = () => { clearTimeout(timer); resolve(c); };
    const timer = setTimeout(() => {
      c.off('ready', onReady);
      reject(new Error(`Redis not ready (status: ${c.status})`));
    }, timeoutMs);
    c.once('ready', onReady);
  });
}

async function safeEnqueue(queue, type, payload) {
  try {
    await enqueue(await getReadyRedis(), queue, type, payload);
    return true;
  } catch (err) {
    console.error(`[queue] could not enqueue ${type}: ${err.message}`);
    return false;
  }
}

/** Part E.2 — every confirmed appointment gets a confirmation SMS/email job. */
function enqueueConfirmation(appointment, source = 'api') {
  return safeEnqueue(keys.notifications, 'APPOINTMENT_CONFIRMATION', {
    source,
    appointment_id: appointment.id,
    patient_id: appointment.patient_id,
    patient_name: appointment.patient_name,
    patient_email: appointment.patient_email,
    doctor_name: appointment.doctor_name,
    room: appointment.room,
    appt_datetime: appointment.appt_datetime,
  });
}

/** Part E.1 — a cancellation freed a slot: ask the worker to promote someone. */
function enqueuePromotion(appointment) {
  return safeEnqueue(keys.promotions, 'WAITLIST_PROMOTION', {
    cancelled_appointment_id: appointment.id,
    doctor_id: appointment.doctor_id,
    appt_datetime: appointment.appt_datetime,
    date: appointment.appt_datetime.slice(0, 10),
  });
}

async function close() {
  if (client) await client.quit().catch(() => client.disconnect());
}

module.exports = { getRedis, getReadyRedis, enqueueConfirmation, enqueuePromotion, close };
