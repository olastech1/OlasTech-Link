const db = require('../../server/db');

module.exports = async function (req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { status, planId, limit = 500 } = req.query;

  let query = `
    SELECT
      ac.*,
      COALESCE(s.data_used, 0) AS data_used_mb
    FROM access_codes ac
    LEFT JOIN sessions s ON s.code = ac.code
  `;
  const conditions = [];
  const params = [];
  let pc = 1;

  if (status) { conditions.push(`ac.status = $${pc++}`); params.push(status); }
  if (planId) { conditions.push(`ac.plan_id = $${pc++}`); params.push(planId); }

  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ` ORDER BY ac.created_at DESC LIMIT $${pc}`;
  params.push(parseInt(limit));

  try {
    const resDb = await db.query(query, params);
    res.json({ success: true, count: resDb.rows.length, codes: resDb.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
