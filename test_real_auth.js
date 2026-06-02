const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });
const http = axios.create({ baseURL: 'https://144.126.203.142:8043', httpsAgent: agent });

async function run() {
  const info = await http.get('/api/info');
  const cid = info.data.result.omadacId;

  const loginRes = await http.post(`/${cid}/api/v2/hotspot/login`, {
    name: 'apiuser',
    password: 'Api12345!'
  });
  console.log('Login:', loginRes.data.msg, '| error:', loginRes.data.errorCode);
  if (loginRes.data.errorCode !== 0) return;

  const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
  const token  = loginRes.data.result.token;
  console.log('Token:', token ? 'OK' : 'MISSING');

  // Test with exact site name from Omada UI
  const tests = ['olastech Link', 'Default', 'olastech', 'Olastech Link'];
  
  for (const site of tests) {
    const res = await http.post(
      `/${cid}/api/v2/hotspot/extPortal/auth`,
      { clientMac:'00-11-22-33-44-55', apMac:'50-3D-D1-B6-12-3E', ssidName:'olastech', radioId:0, time:43200, authType:4, site },
      { headers: { Cookie: cookie, 'Csrf-Token': token } }
    );
    if (typeof res.data === 'object') {
      console.log(`site="${site}" → code=${res.data.errorCode} msg=${res.data.msg}`);
    } else {
      console.log(`site="${site}" → HTML response (wrong path)`);
    }
  }
}
run().catch(e => console.error(e.message));
