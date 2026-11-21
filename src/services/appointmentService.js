// Booking and cancellation business logic. No SQL here: it orchestrates
// model calls inside a transaction. It's used by the HTTP controller now and
// by the waitlist worker (Part E) later, so both share exactly the same rules.
const { withTransaction } = require('../models/db');
const Doctor = require('../models/doctorModel');
const Patient = require('../models/patientModel');
const Appointment = require('../models/appointmentModel');
const { validateSlot } = require('../utils/slot');
const { calculateRefund } = require('../utils/refund');
const { parseLocalDateTime, toSqlDateTime } = require('../utils/datetime');
const { badRequest, notFound, conflict, unprocessable } = require('../utils/errors');
const { clinic } = require('../config');

/**
 * Books an appointment. The rules and how each is guaranteed:
 *  1. Future, 09:00–16:30 start, 30-min boundary → validateSlot() (pure),
 *     backed up by CHECK constraints in MySQL.
 *  2. ≤ 12 per doctor per day → counted inside a transaction AFTER locking
 *     the doctor row (SELECT ... FOR UPDATE). Concurrent bookings for the
 *     same doctor queue behind that lock, so two requests can't both see
 *     "11 booked" and both insert the 12th+13th.
 *  3. No two patients in one slot → the same lock + an explicit check, with
 *     the UNIQUE (doctor_id, appt_datetime, active_slot) index as the final
 *     guarantee (ER_DUP_ENTRY → 409).
 *
 * @returns the created appointment (joined with patient/doctor names)
 */
async function bookAppointment({ patient_id, doctor_id, appt_datetime }, now = new Date()) {
  const slot = validateSlot(appt_datetime, now);
  if (!slot.ok) {
    if (slot.reason === 'MALFORMED') {
      throw badRequest(slot.message, [{ field: 'appt_datetime', message: slot.message }]);
    }
    throw unprocessable(slot.message, slot.reason);
  }

  let appointmentId;
  try {
    appointmentId = await withTransaction(async (conn) => {
      const doctor = await Doctor.lockById(conn, doctor_id);
      if (!doctor) throw notFound(`Doctor ${doctor_id} not found`, 'DOCTOR_NOT_FOUND');

      const patient = await Patient.findById(patient_id, conn);
      if (!patient) throw notFound(`Patient ${patient_id} not found`, 'PATIENT_NOT_FOUND');

      // Part E: a 409 tells the client it can join the waitlist instead.
      const details = { doctor_id, appt_datetime: slot.datetime, waitlist_available: true, waitlist_url: '/api/waitlist' };

      if (await Appointment.isSlotTaken(conn, doctor_id, slot.datetime)) {
        throw conflict(`${doctor.full_name} is already booked at ${slot.datetime}`, 'SLOT_TAKEN', details);
      }

      const bookedThatDay = await Appointment.countBookedOnDay(conn, doctor_id, slot.date);
      if (bookedThatDay >= clinic.dailyCap) {
        throw conflict(
          `${doctor.full_name} is fully booked on ${slot.date} (${clinic.dailyCap} appointments per day maximum)`,
          'DOCTOR_DAY_FULL',
          details,
        );
      }

      // The fee is taken from the doctor row at booking time and frozen on
      // the appointment, so a later fee change can't alter what was paid.
      return Appointment.create(conn, {
        patient_id,
        doctor_id,
        appt_datetime: slot.datetime,
        amount_paid: doctor.consultation_fee,
      });
    });
  } catch (err) {
    // Lost a race that slipped past the check: the unique index decided.
    if (err.code === 'ER_DUP_ENTRY') {
      throw conflict(`That slot was just taken by another booking (${slot.datetime})`, 'SLOT_TAKEN', {
        doctor_id, appt_datetime: slot.datetime, waitlist_available: true, waitlist_url: '/api/waitlist',
      });
    }
    throw err;
  }

  return Appointment.findById(appointmentId);
}

/**
 * Cancels an appointment and records the refund atomically.
 *  - Refund is computed by the server from the notice given (utils/refund).
 *  - The row lock + single UPDATE means cancellation and refund record
 *    succeed or fail together; a concurrent double-cancel gets a 409.
 *  - The row is kept (status='cancelled') for refund history; its
 *    active_slot becomes NULL so the slot is immediately bookable again.
 *
 * @returns {{ appointment, refund: { percentage, amount, noticeHours } }}
 */
async function cancelAppointment(id, now = new Date()) {
  // Truncate to whole seconds: the same instant is used for the refund
  // calculation and stored in cancelled_at (DATETIME has no milliseconds).
  const cancelledAt = new Date(Math.floor(now.getTime() / 1000) * 1000);

  const refund = await withTransaction(async (conn) => {
    const appt = await Appointment.lockById(conn, id);
    if (!appt) throw notFound(`Appointment ${id} not found`);
    if (appt.status === 'cancelled') {
      throw conflict(`Appointment ${id} is already cancelled`, 'ALREADY_CANCELLED');
    }

    const start = parseLocalDateTime(appt.appt_datetime);
    if (start.getTime() <= cancelledAt.getTime()) {
      throw unprocessable(
        `Appointment ${id} started at ${appt.appt_datetime} and can no longer be cancelled`,
        'APPOINTMENT_IN_PAST',
      );
    }

    const result = calculateRefund(appt.amount_paid, start, cancelledAt);
    const updated = await Appointment.markCancelled(conn, id, toSqlDateTime(cancelledAt), result.amount);
    if (!updated) throw conflict(`Appointment ${id} is already cancelled`, 'ALREADY_CANCELLED');
    return result;
  });

  const appointment = await Appointment.findById(id);
  return { appointment, refund };
}

module.exports = { bookAppointment, cancelAppointment };
