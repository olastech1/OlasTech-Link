const db = require('../../server/db');
const { getClientStats } = require('../../server/omada');

module.exports = async function (req, res) {
  try {
    const clients = await getClientStats();
    res.json({
      omadaClients: clients.map(c => ({ mac: c.mac, download: c.download, upload: c.upload }))
    });
  } catch (e) {
    res.json({ error: e.message });
  }
};
