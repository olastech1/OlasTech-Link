const { getClientStats } = require('../../server/omada');

module.exports = async function (req, res) {
  try {
    const clients = await getClientStats();
    res.json({
      total: clients ? clients.length : 0,
      firstClient: clients && clients.length > 0 ? clients[0] : null
    });
  } catch (e) {
    res.json({ error: e.message });
  }
};
