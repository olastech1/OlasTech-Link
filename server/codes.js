/**
 * codes.js — Access Code Generator & Validator
 * Generates unique codes like: S3F7-X9QM
 */

const db = require('./db');
const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 (ambiguous)

async function codeExists(code) {
  const result = await db.query('SELECT 1 FROM access_codes WHERE code = $1', [code]);
  return result.rows.length > 0;
}

/**
 * Generate a unique access code for a given plan.
 */
async function generateCode(planId, paymentRef, email = null) {
  const res = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
  const plan = res.rows[0];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  let code;
  let attempts = 0;
  const prefix = (plan.name || 'C').charAt(0).toUpperCase();

  do {
    if (attempts++ > 50) throw new Error('Failed to generate unique code');
    code = `${prefix}${randomChars(3)}-${randomChars(4)}`;
  } while (await codeExists(code));

  // Data plans never expire by time until data is used. Time-based plans expire based on duration.
  let expiresAt = null;
  if (!plan.data_mb) {
    // If it's an unlimited data plan (daily/weekend), give them 30 days to START using it
    expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  await db.query(`
    INSERT INTO access_codes (code, plan_id, duration_h, data_mb, payment_ref, expires_at, email)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [code, planId, plan.duration_h, plan.data_mb, paymentRef, expiresAt, email]);

  return code;
}

/**
 * Validate and redeem an access code for a given client MAC.
 * Allows up to N devices to share the same code.
 */
async function redeemCode(code, clientMac) {
  const normalised = code.trim().toUpperCase();

  const res = await db.query(`SELECT * FROM access_codes WHERE code = $1`, [normalised]);
  const row = res.rows[0];

  if (!row) {
    throw new Error('Invalid access code. Please check and try again.');
  }

  if (row.status === 'expired') {
    throw new Error('This access code has expired.');
  }
  
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await db.query(`UPDATE access_codes SET status = 'expired' WHERE code = $1`, [normalised]);
    throw new Error('This access code has expired.');
  }

  const planRes = await db.query('SELECT * FROM plans WHERE id = $1', [row.plan_id]);
  const plan = planRes.rows[0];
  if (!plan) throw new Error('Plan not found.');
  
  // Check how many unique devices have already used this code
  const devicesResult = await db.query(`
    SELECT COUNT(DISTINCT client_mac) as "deviceCount"
    FROM sessions 
    WHERE code = $1
  `, [normalised]);
  
  const currentDevices = devicesResult.rows.length > 0 ? parseInt(devicesResult.rows[0].deviceCount, 10) : 0;
  
  // Is this specific MAC already authorized on this code?
  const existingSessionResult = await db.query(`
    SELECT * FROM sessions WHERE code = $1 AND client_mac = $2 AND expires_at > CURRENT_TIMESTAMP
  `, [normalised, clientMac]);
  const existingSession = existingSessionResult.rows[0];

  if (!existingSession && currentDevices >= plan.devices) {
    throw new Error(`Device limit reached. This code only supports up to ${plan.devices} devices.`);
  }

  // If we already have a session, don't create a new one, just return it
  let sessionExpires;
  let remaining_mb;
  if (existingSession) {
    sessionExpires = existingSession.expires_at;
  } else {
    // Create new session
    sessionExpires = new Date(Date.now() + row.duration_h * 60 * 60 * 1000).toISOString();
    
    // Transaction
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // If this is the FIRST device, mark as used
      if (currentDevices === 0) {
        await client.query(`
          UPDATE access_codes
          SET status = 'used', client_mac = $1, used_at = CURRENT_TIMESTAMP
          WHERE code = $2
        `, [clientMac, normalised]);
      }
  
      await client.query(`
        INSERT INTO sessions (code, client_mac, plan_id, expires_at)
        VALUES ($1, $2, $3, $4)
      `, [normalised, clientMac, row.plan_id, sessionExpires]);
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  
  // Calculate remaining data globally for this code
  const allSessionsRes = await db.query(`SELECT data_used FROM sessions WHERE code = $1`, [normalised]);
  let totalUsedMB = 0;
  for (const session of allSessionsRes.rows) {
    totalUsedMB += session.data_used || 0;
  }
  
  remaining_mb = row.data_mb ? Math.max(0, row.data_mb - totalUsedMB) : null;

  return {
    valid: true,
    plan: plan.name,
    planId: row.plan_id,
    duration_h: row.duration_h,
    data_mb: row.data_mb,
    remaining_mb: remaining_mb,
    sessionExpires,
  };
}

/**
 * Create a batch of codes (for voucher printing).
 */
async function generateBatch(planId, count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const c = await generateCode(planId, null);
    codes.push(c);
  }
  return codes;
}

// ── Helpers ──────────────────────────────────────────────────────
function randomChars(n) {
  const bytes = crypto.randomBytes(n);
  return Array.from(bytes)
    .map((b) => CODE_CHARS[b % CODE_CHARS.length])
    .join('');
}

module.exports = { generateCode, redeemCode, generateBatch };
