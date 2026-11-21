const { Router } = require('express');
const c = require('../controllers/doctorController');

const router = Router();

router.route('/')
  .get(c.list)                 // GET    /api/doctors
  .post(c.create);             // POST   /api/doctors

router.route('/:id')
  .get(c.getOne)               // GET    /api/doctors/:id
  .put(c.replace)              // PUT    /api/doctors/:id   (full update)
  .patch(c.patch)              // PATCH  /api/doctors/:id   (partial update)
  .delete(c.remove);           // DELETE /api/doctors/:id

router.get('/:id/stats', c.stats); // GET /api/doctors/:id/stats

module.exports = router;
