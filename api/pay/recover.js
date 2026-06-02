const db = require('../../server/db');
const { generateCode } = require('../../server/codes');
const mailer = require('../../server/mailer');

/**
 * Recover a code for a completed payment where the Flutterwave
 * callback didn't fire (e.g. modal closed early).
 * We check our DB for a successful or pending payment and return
 * the generated code if one exists, or generate it if not yet done.
 */
module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tx_ref } = req.body || {};
  if (!tx_ref) return res.status(400).json({ error: 'Missing tx_ref' });

  try {
    // Look up the payment
    const result = await db.query(
      'SELECT * FROM payments WHERE reference = $1',
      [tx_ref]
    );
    const payment = result.rows[0];
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found. Check your reference.' });
    }

    // Check if a code was already generated for this payment
    const codeResult = await db.query(
      'SELECT code FROM access_codes WHERE payment_ref = $1',
      [tx_ref]
    );

    if (codeResult.rows.length > 0) {
      // Code already exists — return it
      return res.json({ success: true, code: codeResult.rows[0].code, recovered: true });
    }

    // Payment must be successful to generate a code
    if (payment.status !== 'success') {
      return res.status(400).json({
        error: `Payment status is "${payment.status}". If you paid, wait a few minutes and try again.`
      });
    }

    // Generate a new code for this payment
    const code = await generateCode(payment.plan_id, tx_ref, payment.email);
    
    const planRes = await db.query('SELECT name FROM plans WHERE id = $1', [payment.plan_id]);
    const plan = planRes.rows[0];
    
    if (payment.email) {
      mailer.sendSuccessEmail(payment.email, code, plan?.name, payment.amount);
    }

    res.json({ success: true, code, recovered: true });
  } catch (err) {
    console.error('[pay/recover]', err.message);
    res.status(500).json({ error: err.message });
  }
};
