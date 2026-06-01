const { PLANS, generateBatch } = require('../../server/codes');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { planId, count = 10 } = req.body;
  if (!PLANS[planId]) return res.status(400).json({ error: 'Invalid plan' });
  if (count > 200) return res.status(400).json({ error: 'Max 200 codes per batch' });

  try {
    const codes = await generateBatch(planId, parseInt(count));
    res.json({ success: true, planId, count: codes.length, codes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
