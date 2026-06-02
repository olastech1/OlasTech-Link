const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

async function run() {
  try {
    const http = axios.create({ baseURL: 'https://144.126.203.142:8043', httpsAgent: agent });
    const info = await http.get('/api/info');
    const cid = info.data.result.omadacId;
    
    console.log('Controller ID:', cid);

    const loginRes = await http.post(`/${cid}/api/v2/hotspot/login`, {
      name: 'apiuser',
      password: 'Api12345!'
    });
    
    console.log('Login Response:', loginRes.data);
    
    if (loginRes.data.errorCode !== 0) return;

    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
    
    const authRes = await http.post(
      `/${cid}/api/v2/hotspot/extPortal/auth`,
      {
        clientMac: '00:11:22:33:44:55',
        apMac: '66:77:88:99:AA:BB',
        ssidName: 'olastech',
        radioId: '1',
        time: 60,
        authType: 4,
        site: 'Default' // In Omada v5, maybe this needs to be siteId? Or Omada v5 extPortal/auth doesn't use 'site'?
      },
      { headers: { Cookie: cookie } }
    );
    
    console.log('Auth Response:', authRes.data);
  } catch (err) {
    console.error('HTTP Error:', err.response ? err.response.data : err.message);
  }
}
run();
