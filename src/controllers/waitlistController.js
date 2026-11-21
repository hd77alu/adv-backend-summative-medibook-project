const Patient = require('../models/patientModel');
const Doctor = require('../models/doctorModel');
const Appointment = require('../models/appointmentModel');
const waitlist = require('../queue/waitlist');
const { getReadyRedis } = require('../queue/producer');
const { validateBooking, parseId } = require('../validators');
const { validateSlot } = require('../utils/slot');
const { badRequest, notFound, conflict, unprocessable, AppError } = require('../utils/errors');
const { audit } = require('../utils/auditLogger');
const { assertValid } = require('./helpers');
const { clinic } = require('../config');

const redisUnavailable = () =>
  new AppError(503, 'Waitlist is temporarily unavailable, please try again shortly', { code: 'SERVICE_UNAVAILABLE' });

/**
 * POST /api/waitlist  { patient_id, doctor_id, appt_datetime }
 * Only offered when the requested slot (or the doctor's whole day) is full:
 *  - slot taken, day has room → wait for THAT slot      (any_slot = false)
 *  - day full                 → take ANY freed slot that day (any_slot = true)
 */
async function join(req, res) {
  const result = validateBooking(req.body);
  assertValid(result);
  const { patient_id, doctor_id, appt_datetime } = result.value;

  const slot = validateSlot(appt_datetime);
  if (!slot.ok) {
    if (slot.reason === 'MALFORMED') throw badRequest(slot.message, [{ field: 'appt_datetime', message: slot.message }]);
    throw unprocessable(slot.message, slot.reason);
  }

  if (!(await Patient.findById(patient_id))) throw notFound(`Patient ${patient_id} not found`, 'PATIENT_NOT_FOUND');
  const doctor = await Doctor.findById(doctor_id);
  if (!doctor) throw notFound(`Doctor ${doctor_id} not found`, 'DOCTOR_NOT_FOUND');

  const existing = await Appointment.findActiveForPatientOnDay(patient_id, doctor_id, slot.date);
  if (existing) {
    throw conflict(`Patient ${patient_id} already has an appointment with ${doctor.full_name} on ${slot.date} (#${existing.id})`, 'ALREADY_BOOKED');
  }

  const { bookedThatDay, slotTaken } = await Appointment.getSlotAvailability(doctor_id, slot.date, slot.datetime);
  const dayFull = bookedThatDay >= clinic.dailyCap;
  if (!dayFull && !slotTaken) {
    throw conflict(`${slot.datetime} with ${doctor.full_name} is available — book it directly with POST /api/appointments`, 'SLOT_AVAILABLE');
  }

  let joined;
  try {
    joined = await waitlist.join(await getReadyRedis(), {
      patient_id, doctor_id, date: slot.date, requested_datetime: slot.datetime, any_slot: dayFull,
    });
  } catch (err) {
    console.error(`[waitlist] join failed: ${err.message}`);
    throw redisUnavailable();
  }
  if (!joined) {
    throw conflict(`Patient ${patient_id} is already on the waitlist for ${doctor.full_name} on ${slot.date}`, 'ALREADY_WAITLISTED');
  }

  audit('WAITLIST_JOINED', { ...joined.entry, position: joined.position });

  res.status(201).json({
    message: dayFull
      ? `${doctor.full_name} is fully booked on ${slot.date}. You are #${joined.position} on the waitlist and will be booked into the first slot that frees up that day.`
      : `${slot.datetime} is taken. You are #${joined.position} on the waitlist and will be booked automatically if that slot frees up.`,
    data: { ...joined.entry, position: joined.position },
  });
}

/** GET /api/waitlist?doctor_id=1&date=2026-11-24 */
async function list(req, res) {
  const doctor_id = parseId(req.query.doctor_id);
  const { date } = req.query;
  const errors = [];
  if (!doctor_id) errors.push({ field: 'doctor_id', message: 'doctor_id query parameter is required (positive integer)' });
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push({ field: 'date', message: 'date query parameter is required (YYYY-MM-DD)' });
  if (errors.length) throw badRequest('Invalid query parameters', errors);

  let entries;
  try {
    entries = await waitlist.list(await getReadyRedis(), doctor_id, date);
  } catch (err) {
    console.error(`[waitlist] list failed: ${err.message}`);
    throw redisUnavailable();
  }
  res.json({ data: entries, count: entries.length });
}

module.exports = { join, list };
