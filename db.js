const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// CRITICAL — handle connection errors without crashing the server
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client — reconnecting...', err.message);
  // Do NOT crash — just log and continue
  // The pool will automatically create a new connection on next query
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to Neon PostgreSQL:', err.message);
  } else {
    console.log('Connected to Neon PostgreSQL successfully!');
    release();
  }
});

module.exports = pool;