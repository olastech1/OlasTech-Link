module.exports = async function(req, res) {
  const axios = require('axios');
  const https = require('https');
  const agent = new https.Agent({ rejectUnauthorized: false });
  const http = axios.create({ baseURL: 'https://144.126.203.142:8043', httpsAgent: agent, timeout: 8000 });
  
  // Show env vars (masked for security)
  const envInfo = {
    OMADA_USERNAME:   process.env.OMADA_USERNAME || 'NOT SET',
    OMADA_SITE_NAME:  process.env.OMADA_SITE_NAME || 'NOT SET',
    OMADA_CONTROLLER_URL: process.env.OMADA_CONTROLLER_URL || 'NOT SET',
    OMADA_PASSWORD:   process.env.OMADA_PASSWORD ? '(set)' : 'NOT SET',
  };

  try {
    const info = await http.get('/api/info');
    const cid = info.data.result.omadacId;
    const login = await http.post(`/${cid}/api/v2/hotspot/login`, {
      name: process.env.OMADA_USERNAME,
      password: process.env.OMADA_PASSWORD
    });
    const token = login.data.result?.token;
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];

    // Test 1: with wrong ssidName (old bug)
    const auth1 = await http.post(`/${cid}/api/v2/hotspot/extPortal/auth`, {
      clientMac:'00-11-22-33-44-55', apMac:'50-3D-D1-B6-12-3E',
      ssidName: process.env.OMADA_SITE_NAME,  // WRONG - this is site name not ssid
      radioId:0, time:60, authType:4,
      site: process.env.OMADA_SITE_NAME
    }, { headers: { Cookie: cookie, 'Csrf-Token': token } });

    // Test 2: with correct ssidName 'olastech'
    const auth2 = await http.post(`/${cid}/api/v2/hotspot/extPortal/auth`, {
      clientMac:'00-11-22-33-44-55', apMac:'50-3D-D1-B6-12-3E',
      ssidName: 'olastech',  // CORRECT - actual WiFi name
      radioId:0, time:60, authType:4,
      site: process.env.OMADA_SITE_NAME
    }, { headers: { Cookie: cookie, 'Csrf-Token': token } });

    res.json({
      envInfo,
      reachable: true,
      loginCode: login.data.errorCode,
      loginMsg: login.data.msg,
      test1_wrongSsidName: { code: auth1.data.errorCode, msg: auth1.data.msg },
      test2_correctSsidName: { code: auth2.data.errorCode, msg: auth2.data.msg },
    });
  } catch(e) {
    res.json({ envInfo, reachable: false, error: e.message, code: e.code });
  }
};
