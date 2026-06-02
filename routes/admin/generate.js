const { generateBatch } = require('../../server/codes');
const db = require('../../server/db');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { planId, count } = req.body;
  if (!planId) return res.status(400).json({ error: 'Missing planId' });

  try {
    const planRes = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
    if (planRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const qty = Math.min(parseInt(count) || 1, 200);
    const codes = await generateBatch(planId, qty);
    
    return res.json({ success: true, codes });
  } catch (err) {
    console.error('[admin/generate]', err);
    return res.status(500).json({ error: 'Failed to generate codes: ' + err.message });
  }
};
