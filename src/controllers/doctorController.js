const Doctor = require('../models/doctorModel');
const { validateDoctor } = require('../validators');
const { notFound } = require('../utils/errors');
const { requireId, assertValid } = require('./helpers');
const { clinic } = require('../config');

async function list(req, res) {
  const doctors = await Doctor.findAll();
  res.json({ data: doctors, count: doctors.length });
}

async function getOne(req, res) {
  const id = requireId(req);
  const doctor = await Doctor.findById(id);
  if (!doctor) throw notFound(`Doctor ${id} not found`);
  res.json({ data: doctor });
}

async function create(req, res) {
  const result = validateDoctor(req.body);
  assertValid(result);
  const doctor = await Doctor.create(result.value);
  res.status(201).location(`/api/doctors/${doctor.id}`).json({ data: doctor });
}

function update({ partial }) {
  return async (req, res) => {
    const id = requireId(req);
    const result = validateDoctor(req.body, { partial });
    assertValid(result);
    // A fee change only affects future bookings: amount_paid is frozen per appointment.
    const doctor = await Doctor.update(id, result.value);
    if (!doctor) throw notFound(`Doctor ${id} not found`);
    res.json({ data: doctor });
  };
}

async function remove(req, res) {
  const id = requireId(req);
  const deleted = await Doctor.remove(id); // has appointments → 409 (FK RESTRICT)
  if (!deleted) throw notFound(`Doctor ${id} not found`);
  res.status(204).end();
}

/** GET /api/doctors/:id/stats — every figure is computed by SQL in the model. */
async function stats(req, res) {
  const id = requireId(req);
  const summary = await Doctor.getStats(id, clinic.dailyCap);
  if (!summary) throw notFound(`Doctor ${id} not found`);
  const next7Days = await Doctor.getDailyLoad(id, clinic.dailyCap);
  res.json({
    data: {
      ...summary,
      daily_capacity: clinic.dailyCap,
      next_7_days: next7Days,
    },
  });
}

module.exports = {
  list, getOne, create, replace: update({ partial: false }), patch: update({ partial: true }), remove, stats,
};
