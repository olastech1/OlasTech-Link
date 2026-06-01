const db = require('../../server/db');

module.exports = async function (req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { status, planId, limit = 100 } = req.query;
  
  let query = 'SELECT * FROM access_codes';
  const conditions = [];
  const params = [];
  let paramCounter = 1;

  if (status)  { conditions.push(`status = $${paramCounter++}`); params.push(status); }
  if (planId)  { conditions.push(`plan_id = $${paramCounter++}`); params.push(planId); }
  
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');

  query += ` ORDER BY created_at DESC LIMIT $${paramCounter}`;
  params.push(parseInt(limit));

  try {
    const resDb = await db.query(query, params);
    const codes = resDb.rows;
    res.json({ success: true, count: codes.length, codes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
