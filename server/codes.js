/**
 * codes.js — Access Code Generator & Validator
 * Generates unique codes like: S3F7K-X9QM
 */

const db = require('./db');
const crypto = require('crypto');

// ── Plan definitions ─────────────────────────────────────────────
const PLANS = {
  '300gb':   { name: '300GB',           price: 35000, duration_h: 720, data_mb: 307200, devices: 10, prefix: 'X' },
  '250gb':   { name: '250GB',           price: 20000, duration_h: 720, data_mb: 256000, devices: 5,  prefix: 'V' },
  '150gb':   { name: '150GB',           price: 15000, duration_h: 720, data_mb: 153600, devices: 4,  prefix: 'L' },
  '110gb':   { name: '110GB',           price: 12000, duration_h: 720, data_mb: 112640, devices: 4,  prefix: 'M' },
  '50gb':    { name: '50GB',            price: 5000,  duration_h: 720, data_mb: 51200,  devices: 4,  prefix: 'S' },
  'weekend': { name: 'Weekend Unltd',   price: 10000, duration_h: 48,  data_mb: null,   devices: 5,  prefix: 'W' },
  'daily':   { name: 'Daily Unltd',     price: 3000,  duration_h: 24,  data_mb: null,   devices: 3,  prefix: 'D' },
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 (ambiguous)

async function codeExists(code) {
  const result = await db.query('SELECT 1 FROM access_codes WHERE code = $1', [code]);
  return result.rows.length > 0;
}

/**
 * Generate a unique access code for a given plan.
 * Format: {PREFIX}{4chars}-{4chars}  e.g. S3F7K-X9QM
 */
async function generateCode(planId, paymentRef, email = null) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  let code;
  let attempts = 0;

  do {
    if (attempts++ > 50) throw new Error('Failed to generate unique code');
    const part1 = randomChars(4);
    const part2 = randomChars(4);
    code = `${plan.prefix}${part1}-${part2}`;
  } while (await codeExists(code));

  // Calculate expiry (from now, giving user 48h to use the code before it auto-expires)
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

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

  const plan = PLANS[row.plan_id];
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
 * Create a batch of pre-generated codes (for voucher printing).
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

module.exports = { PLANS, generateCode, redeemCode, generateBatch };
