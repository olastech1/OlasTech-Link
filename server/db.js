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
        data_used       NUMERIC DEFAULT 0,
        last_activity_bytes BIGINT DEFAULT 0,
        time_used       BIGINT DEFAULT 0,
        last_activity_time BIGINT DEFAULT 0,
        notified_200mb  INTEGER DEFAULT 0,
        started_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at      TIMESTAMP NOT NULL
      );

      -- Plans: dynamic hotspot plans
      CREATE TABLE IF NOT EXISTS plans (
        id            VARCHAR(255) PRIMARY KEY,
        name          VARCHAR(255) NOT NULL,
        price         INTEGER NOT NULL,
        duration_h    INTEGER NOT NULL,
        data_mb       INTEGER,
        devices       INTEGER NOT NULL DEFAULT 1,
        is_popular    BOOLEAN DEFAULT false,
        is_best_value BOOLEAN DEFAULT false,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes for fast lookups
      CREATE INDEX IF NOT EXISTS idx_codes_code   ON access_codes(code);
      CREATE INDEX IF NOT EXISTS idx_codes_status ON access_codes(status);
      CREATE INDEX IF NOT EXISTS idx_pay_ref      ON payments(reference);

      -- Migrations
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity_bytes BIGINT DEFAULT 0;
      ALTER TABLE sessions ALTER COLUMN data_used TYPE NUMERIC;
    `);

    // Sync dynamic plans
    const newPlans = [
      ['300gb',   '300GB',             35000, 720, 307200, 10, false, true],
      ['250gb',   '250GB',             20000, 720, 256000,  5, false, false],
      ['150gb',   '150GB',             15000, 720, 153600,  4, false, false],
      ['110gb',   '110GB',             12000, 720, 112640,  4, true,  false],
      ['50gb',    '50GB',               5000, 720,  51200,  4, false, false],
      ['weekend', 'Weekend Unlimited', 10000,  48,   null,  5, false, false],
      ['daily',   'Daily Unlimited',    3000,  24,   null,  3, false, false],
    ];

    const planIds = newPlans.map(p => p[0]);

    for (const p of newPlans) {
      await client.query(`
        INSERT INTO plans (id, name, price, duration_h, data_mb, devices, is_popular, is_best_value)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          duration_h = EXCLUDED.duration_h,
          data_mb = EXCLUDED.data_mb,
          devices = EXCLUDED.devices,
          is_popular = EXCLUDED.is_popular,
          is_best_value = EXCLUDED.is_best_value
      `, p);
    }

    await client.query(`DELETE FROM plans WHERE id NOT IN (${planIds.map(id => `'${id}'`).join(',')})`);

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

