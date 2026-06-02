const db = require('../../server/db');
const { getClientStats } = require('../../server/omada');

module.exports = async function (req, res) {
  try {
    const clients = await getClientStats();
    const activeRes = await db.query(`SELECT id, client_mac, data_used, last_activity_bytes, expires_at FROM sessions ORDER BY started_at DESC LIMIT 5`);
    
    res.json({
      activeDbSessions: activeRes.rows,
      omadaClientsFound: clients ? clients.length : 0,
      omadaTopClients: clients ? clients.slice(0, 3) : []
    });
  } catch (e) {
    res.json({ error: e.message });
  }
};
