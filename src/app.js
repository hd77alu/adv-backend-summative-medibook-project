// Express app (no listen() here, so it can be imported in tests).
const express = require('express');
const apiRoutes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' })); // HTML form posts (Part G)

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', apiRoutes);
app.use('/feedback', require('./routes/feedbackRoutes'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
