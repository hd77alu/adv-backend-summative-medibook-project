const { Router } = require('express');
const c = require('../controllers/feedbackController');

const router = Router();

router.get('/', c.show);     // GET  /feedback?lang=en|fr  → HTML form
router.post('/', c.submit);  // POST /feedback?lang=en|fr  → thank-you page (400 if an answer is missing)

module.exports = router;
