const { authorizeClient } = require('../../server/omada');
module.exports = async function (req, res) {
  try {
    // try to authorize a dummy client to see if it throws Invalid username or password
    await authorizeClient({ clientMac: '00-11-22-33-44-55', apMac: 'AA-BB-CC-DD-EE-FF', ssidName: 'olastech', duration: 10 });
    res.json({ success: true });
  } catch (e) {
    res.json({ error: e.message });
  }
};
