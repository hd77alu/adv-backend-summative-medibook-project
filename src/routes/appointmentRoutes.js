const { Router } = require('express');
const c = require('../controllers/appointmentController');

const router = Router();

router.post('/', c.book);          // POST   /api/appointments      → book (201)
router.get('/:id', c.getOne);      // GET    /api/appointments/:id
router.delete('/:id', c.cancel);   // DELETE /api/appointments/:id  → cancel + refund (200)

module.exports = router;
