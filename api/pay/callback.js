const db = require('../../server/db');
const flutterwave = require('../../server/flutterwave');
const { PLANS, generateCode } = require('../../server/codes');
const mailer = require('../../server/mailer');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { transaction_id, tx_ref } = req.body;

  if (!transaction_id || !tx_ref) {
    return res.status(400).json({ error: 'Missing transaction references.' });
  }

  try {
    // Verify with Flutterwave
    const flwData = await flutterwave.verifyPayment(transaction_id);

    // Get the stored payment record
    const paymentRes = await db.query('SELECT * FROM payments WHERE reference = $1', [tx_ref]);
    const payment = paymentRes.rows[0];
    
    if (!payment) return res.status(404).json({ error: 'Payment record not found.' });

    // Validate amount matches
    if (flwData.amount < payment.amount) {
       return res.status(400).json({ error: 'Payment amount mismatch.' });
    }

    // Mark payment as successful
    await db.query(`
      UPDATE payments SET status = 'success', paid_at = CURRENT_TIMESTAMP
      WHERE reference = $1
    `, [tx_ref]);

    // Generate the access code
    const code = await generateCode(payment.plan_id, tx_ref, payment.email);
    
    const plan = PLANS[payment.plan_id];
    if (payment.email) {
      mailer.sendSuccessEmail(payment.email, code, plan.name, payment.amount);
    }

    // Return the code to the frontend
    res.json({ success: true, code, planId: payment.plan_id });
  } catch (err) {
    console.error('[pay/callback]', err.message);

    // Mark payment as failed
    await db.query(`UPDATE payments SET status = 'failed' WHERE reference = $1`, [tx_ref]);
    res.status(500).json({ error: err.message || 'Payment verification failed.' });
  }
};
