const { _adminLogin, http } = require('../../server/omada');
const SITE_NAME = process.env.OMADA_SITE_NAME || 'Default';

module.exports = async function (req, res) {
  try {
    const { cid, cookie, token } = await _adminLogin();

    const payload = {
      clientMac: '00-11-22-33-44-55', apMac: 'AA-BB-CC-DD-EE-FF',
      ssidName: 'olastech', radioId: 0, time: 10, authType: 4, site: SITE_NAME,
    };

    const r = await http.post(`/${cid}/api/v2/hotspot/extPortal/auth`, payload, { headers: { Cookie: cookie, 'Csrf-Token': token } });
    
    res.json({ success: true, data: r.data });
  } catch (e) {
    res.json({ error: e.message });
  }
};
