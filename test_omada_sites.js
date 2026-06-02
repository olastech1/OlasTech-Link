const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });
const http = axios.create({ baseURL: 'https://144.126.203.142:8043', httpsAgent: agent });
async function run() {
  const info = await http.get('/api/info');
  const cid = info.data.result.omadacId;
  const login = await http.post(`/${cid}/api/v2/login`, { username: 'olastech', password: process.env.OMADA_PASS || 'admin' }); 
  
  if (login.data.errorCode !== 0) { console.log('Login failed'); return; }
  
  const token = login.data.result.token;
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  
  const sites = await http.get(`/${cid}/api/v2/sites`, { headers: { Cookie: cookie, 'Csrf-Token': token } });
  console.log(JSON.stringify(sites.data, null, 2));
}
run();
