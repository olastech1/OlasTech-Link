const db = require('../../server/db');

module.exports = async function (req, res) {
  // Simple auth
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const { rows } = await db.query('SELECT * FROM plans ORDER BY price DESC');
      return res.json({ success: true, plans: rows });
    }

    if (req.method === 'POST') {
      const { id, name, price, duration_h, data_mb, devices, is_popular, is_best_value } = req.body;
      
      if (!id || !name || price === undefined || duration_h === undefined || devices === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Upsert plan
      await db.query(`
        INSERT INTO plans (id, name, price, duration_h, data_mb, devices, is_popular, is_best_value)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          duration_h = EXCLUDED.duration_h,
          data_mb = EXCLUDED.data_mb,
          devices = EXCLUDED.devices,
          is_popular = EXCLUDED.is_popular,
          is_best_value = EXCLUDED.is_best_value
      `, [id, name, price, duration_h, data_mb || null, devices, is_popular || false, is_best_value || false]);

      return res.json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing plan ID' });
      
      await db.query('DELETE FROM plans WHERE id = $1', [id]);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[api/admin/plans]', err);
    res.status(500).json({ error: 'Database operation failed: ' + err.message });
  }
};
