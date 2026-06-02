const db = require('../../server/db');
module.exports = async function (req, res) {
  try {
    const res1 = await db.query(`SELECT * FROM sessions WHERE LOWER(client_mac) LIKE '%da%03%ad%c5%62%4e%'`);
    const all = await db.query(`SELECT id, client_mac, expires_at FROM sessions`);
    res.json({ 
      foundDa03: res1.rows,
      allSessions: all.rows 
    });
  } catch (e) {
    res.json({ error: e.message });
  }
};
