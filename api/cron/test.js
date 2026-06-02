const db = require('../../server/db');

module.exports = async function (req, res) {
  try {
    const res1 = await db.query(`SELECT * FROM sessions WHERE client_mac = 'DA-03-AD-C5-62-4E' OR client_mac = 'DA:03:AD:C5:62:4E'`);
    res.json({ sessionsFound: res1.rows });
  } catch (e) {
    res.json({ error: e.message });
  }
};
