const Appointment = require('../models/appointmentModel');
const appointmentService = require('../services/appointmentService');
const { validateBooking } = require('../validators');
const { notFound } = require('../utils/errors');
const { audit } = require('../utils/auditLogger');
const { requireId, assertValid } = require('./helpers');

/** POST /api/appointments — book a slot. */
async function book(req, res) {
  const result = validateBooking(req.body);
  assertValid(result);

  const appointment = await appointmentService.bookAppointment(result.value);

  // Part D: we don't await this. audit() never rejects, and a logging
  // failure must not fail or slow down the booking response.
  audit('APPOINTMENT_BOOKED', {
    appointment_id: appointment.id,
    patient_id: appointment.patient_id,
    doctor_id: appointment.doctor_id,
    appt_datetime: appointment.appt_datetime,
    amount_paid: appointment.amount_paid,
  });

  res.status(201).location(`/api/appointments/${appointment.id}`).json({ data: appointment });
}

/** GET /api/appointments/:id */
async function getOne(req, res) {
  const id = requireId(req);
  const appointment = await Appointment.findById(id);
  if (!appointment) throw notFound(`Appointment ${id} not found`);
  res.json({ data: appointment });
}

/**
 * DELETE /api/appointments/:id — cancel. To the client the booking is gone.
 * On the server it's a soft delete: the row is kept with status 'cancelled'
 * and the refund record. Returns 200 with the refund the server computed.
 */
async function cancel(req, res) {
  const id = requireId(req);
  const { appointment, refund } = await appointmentService.cancelAppointment(id);

  audit('APPOINTMENT_CANCELLED', {
    appointment_id: appointment.id,
    patient_id: appointment.patient_id,
    doctor_id: appointment.doctor_id,
    appt_datetime: appointment.appt_datetime,
    amount_paid: appointment.amount_paid,
    refund_percentage: refund.percentage,
    refund_amount: refund.amount,
    notice_hours: refund.noticeHours,
  });

  // Part E hook: notify the waitlist that this slot is free (added with the queue).

  res.json({
    message: `Appointment ${id} cancelled. Refund: ${refund.amount.toFixed(2)} (${refund.percentage}% for ${refund.noticeHours} hours' notice).`,
    data: {
      appointment,
      refund: {
        amount: refund.amount,
        percentage: refund.percentage,
        notice_hours: refund.noticeHours,
        policy: '> 48h notice: 100%; 24–48h: 50%; < 24h: 0%',
      },
    },
  });
}

module.exports = { book, getOne, cancel };
