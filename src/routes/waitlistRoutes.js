const { Router } = require('express');
const c = require('../controllers/waitlistController');

const router = Router();

router.post('/', c.join);   // POST /api/waitlist                       → join (201)
router.get('/', c.list);    // GET  /api/waitlist?doctor_id=&date=      → queue in order

module.exports = router;
