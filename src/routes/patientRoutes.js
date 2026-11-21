const { Router } = require('express');
const c = require('../controllers/patientController');

const router = Router();

router.route('/')
  .get(c.list)                 // GET    /api/patients
  .post(c.create);             // POST   /api/patients

router.route('/:id')
  .get(c.getOne)               // GET    /api/patients/:id
  .put(c.replace)              // PUT    /api/patients/:id   (full update)
  .patch(c.patch)              // PATCH  /api/patients/:id   (partial update)
  .delete(c.remove);           // DELETE /api/patients/:id

router.get('/:id/appointments', c.listAppointments); // a patient's bookings & cancellations

module.exports = router;
