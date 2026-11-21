const Patient = require('../models/patientModel');
const { validatePatient } = require('../validators');
const { notFound } = require('../utils/errors');
const { requireId, assertValid } = require('./helpers');

async function list(req, res) {
  const patients = await Patient.findAll();
  res.json({ data: patients, count: patients.length });
}

async function getOne(req, res) {
  const id = requireId(req);
  const patient = await Patient.findById(id);
  if (!patient) throw notFound(`Patient ${id} not found`);
  res.json({ data: patient });
}

async function create(req, res) {
  const result = validatePatient(req.body);
  assertValid(result);
  const patient = await Patient.create(result.value); // duplicate email → 409 (error handler)
  res.status(201).location(`/api/patients/${patient.id}`).json({ data: patient });
}

// PUT replaces the whole resource (all fields required);
// PATCH updates only the fields supplied.
function update({ partial }) {
  return async (req, res) => {
    const id = requireId(req);
    const result = validatePatient(req.body, { partial });
    assertValid(result);
    const patient = await Patient.update(id, result.value);
    if (!patient) throw notFound(`Patient ${id} not found`);
    res.json({ data: patient });
  };
}

async function remove(req, res) {
  const id = requireId(req);
  // A patient with appointment history can't be deleted (FK RESTRICT → 409),
  // because that would destroy booking and refund records.
  const deleted = await Patient.remove(id);
  if (!deleted) throw notFound(`Patient ${id} not found`);
  res.status(204).end();
}

async function listAppointments(req, res) {
  const id = requireId(req);
  if (!(await Patient.findById(id))) throw notFound(`Patient ${id} not found`);
  const appointments = await Patient.findAppointments(id);
  res.json({ data: appointments, count: appointments.length });
}

module.exports = {
  list, getOne, create, replace: update({ partial: false }), patch: update({ partial: true }), remove, listAppointments,
};
