const axios = require('axios');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });
const http = axios.create({ baseURL: 'https://144.126.203.142:8043', httpsAgent: agent });

async function run() {
  try {
    const info = await http.get('/api/info');
    const cid = info.data.result.omadacId;
    console.log('Controller ID:', cid);

    const login = await http.post(`/${cid}/api/v2/hotspot/login`, { username: 'olastech', password: process.env.OMADA_PASS || 'admin' });
    console.log('Login:', login.data);
    
    if (login.data.errorCode !== 0) return;
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    
    // In Omada API v5, getting sites:
    const sites = await http.get(`/${cid}/api/v2/sites`, { headers: { Cookie: cookie }});
    console.log('Sites:', JSON.stringify(sites.data, null, 2));
  } catch (e) {
    console.error(e.message);
  }
}
run();
