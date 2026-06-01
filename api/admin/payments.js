const db = require('../../server/db');

module.exports = async function (req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const resDb = await db.query('SELECT * FROM payments ORDER BY created_at DESC LIMIT 200');
    const payments = resDb.rows;
    res.json({ success: true, count: payments.length, payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
