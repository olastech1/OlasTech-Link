const crypto = require('crypto');
const db = require('../../server/db');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { planId, email, clientMac, apMac, radioId } = req.body;

  try {
    const planRes = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
    const plan = planRes.rows[0];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan selected.' });
    }

    const reference = `OTL-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Store pending payment (postgres)
    await db.query(`
      INSERT INTO payments (reference, plan_id, amount, email, status, client_mac)
      VALUES ($1, $2, $3, $4, 'pending', $5)
    `, [reference, planId, plan.price, email || 'guest@olastech.ng', clientMac || '']);

    // Return init details to frontend
    res.json({
      success: true,
      reference,
      amount: plan.price,
      name: plan.name,
      publicKey: process.env.FLW_PUBLIC_KEY,
    });
  } catch (err) {
    console.error('[pay/init]', err.message);
    res.status(500).json({ error: 'Payment initialization failed. Please try again.' });
  }
};
