const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.connect((err, client, release) => {
  if (err) {
    console.log('Database connection failed:', err.message);
  } else {
    console.log('Connected to Neon PostgreSQL successfully!');
    release();
  }
});

module.exports = pool;