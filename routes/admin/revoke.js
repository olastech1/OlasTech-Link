const db = require('../../server/db');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    // Mark code as revoked
    const result = await db.query(
      `UPDATE access_codes SET status = 'revoked' WHERE code = $1 AND status != 'revoked' RETURNING *`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Code not found or already revoked' });
    }

    // Also remove any active session for this code
    await db.query(`DELETE FROM sessions WHERE code = $1`, [code]);

    res.json({ success: true, message: 'Code revoked successfully', code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
