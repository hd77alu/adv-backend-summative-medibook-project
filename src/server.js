const app = require('./app');
const config = require('./config');
const { pool, ping } = require('./models/db');
const { close: closeQueue, getRedis } = require('./queue/producer');

async function start() {
  // Fail fast with a clear message if MySQL isn't reachable or misconfigured.
  try {
    await ping();
  } catch (err) {
    console.error(`Cannot connect to MySQL at ${config.db.host}:${config.db.port} as "${config.db.user}" (db "${config.db.database}"): ${err.code || err.message}`);
    console.error('Check your .env (see .env.example) and that database/schema.sql has been run.');
    process.exit(1);
  }

  // Open the Redis connection now rather than on the first request. Redis is
  // optional for start-up: if it's down the API still serves bookings, and
  // the waitlist answers 503 until Redis is back.
  getRedis();

  const server = app.listen(config.port, () => {
    console.log(`MediBook API listening on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    server.close(() => Promise.allSettled([pool.end(), closeQueue()]).finally(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
