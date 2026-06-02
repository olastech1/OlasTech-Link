module.exports = async function(req, res) {
  const axios = require('axios');
  const https = require('https');
  const agent = new https.Agent({ rejectUnauthorized: false });
  const http = axios.create({ baseURL: 'https://144.126.203.142:8043', httpsAgent: agent, timeout: 8000 });
  try {
    const info = await http.get('/api/info');
    const cid = info.data.result.omadacId;
    const login = await http.post(`/${cid}/api/v2/hotspot/login`, {
      name: process.env.OMADA_USERNAME,
      password: process.env.OMADA_PASSWORD
    });
    const token = login.data.result?.token;
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    const auth = await http.post(`/${cid}/api/v2/hotspot/extPortal/auth`, {
      clientMac:'00-11-22-33-44-55', apMac:'50-3D-D1-B6-12-3E',
      ssidName: process.env.OMADA_SITE_NAME, radioId:0, time:60, authType:4,
      site: process.env.OMADA_SITE_NAME
    }, { headers: { Cookie: cookie, 'Csrf-Token': token } });
    res.json({ reachable: true, loginCode: login.data.errorCode, loginMsg: login.data.msg, authCode: auth.data.errorCode, authMsg: auth.data.msg, isHtml: typeof auth.data !== 'object' });
  } catch(e) {
    res.json({ reachable: false, error: e.message, code: e.code });
  }
};
