const db = require('../server/db');

module.exports = async function (req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { rows } = await db.query('SELECT * FROM plans ORDER BY price DESC');
    res.json({ success: true, plans: rows });
  } catch (err) {
    console.error('[api/plans]', err);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
};
