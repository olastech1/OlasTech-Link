/**
 * db.js — PostgreSQL Database Setup (Neon DB)
 * Stores access codes, payments, and sessions.
 */

const { Pool } = require('pg');
require('dotenv').config();

let pool;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
}

let isInitialized = false;

async function initDb() {
  if (!pool) throw new Error('DATABASE_URL is not configured.');
  if (isInitialized) return;
  
  const client = await pool.connect();
  try {
    await client.query(`
      -- Payments: records every purchase attempt
      CREATE TABLE IF NOT EXISTS payments (
        id          SERIAL PRIMARY KEY,
        reference   VARCHAR(255) UNIQUE NOT NULL,
        plan_id     VARCHAR(255) NOT NULL,
        amount      INTEGER NOT NULL,
        email       VARCHAR(255),
        status      VARCHAR(50) NOT NULL DEFAULT 'pending',
        client_mac  VARCHAR(255),
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at     TIMESTAMP
      );

      -- Access Codes: generated after successful payment
      CREATE TABLE IF NOT EXISTS access_codes (
        id          SERIAL PRIMARY KEY,
        code        VARCHAR(255) UNIQUE NOT NULL,
        plan_id     VARCHAR(255) NOT NULL,
        duration_h  INTEGER NOT NULL,
        data_mb     INTEGER,
        payment_ref VARCHAR(255) REFERENCES payments(reference),
        status      VARCHAR(50) NOT NULL DEFAULT 'active',
        client_mac  VARCHAR(255),
        email       VARCHAR(255),
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        used_at     TIMESTAMP,
        expires_at  TIMESTAMP
      );

      -- Sessions: active internet sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id              SERIAL PRIMARY KEY,
        code            VARCHAR(255) NOT NULL REFERENCES access_codes(code),
        client_mac      VARCHAR(255) NOT NULL,
        plan_id         VARCHAR(255) NOT NULL,
        data_used       INTEGER DEFAULT 0,
        last_activity_bytes BIGINT DEFAULT 0,
        notified_200mb  INTEGER DEFAULT 0,
        started_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at      TIMESTAMP NOT NULL
      );

      -- Create indexes for fast lookups
      CREATE INDEX IF NOT EXISTS idx_codes_code   ON access_codes(code);
      CREATE INDEX IF NOT EXISTS idx_codes_status ON access_codes(status);
      CREATE INDEX IF NOT EXISTS idx_pay_ref      ON payments(reference);

      -- Migrations
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity_bytes BIGINT DEFAULT 0;
      ALTER TABLE sessions ALTER COLUMN data_used TYPE NUMERIC;
    `);
    isInitialized = true;
  } catch (error) {
    console.error('Database initialization failed:', error);
  } finally {
    client.release();
  }
}

module.exports = {
  query: async (text, params) => {
    if (!pool) throw new Error('DATABASE_URL is not set in Environment Variables');
    await initDb();
    return pool.query(text, params);
  },
  pool
};

