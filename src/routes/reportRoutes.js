const { Router } = require('express');
const c = require('../controllers/reportController');

const router = Router();

router.get('/doctors', c.doctors);       // GET /api/reports/doctors
router.get('/busy-days', c.busyDays);    // GET /api/reports/busy-days?from=&to=

module.exports = router;
