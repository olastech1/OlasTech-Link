const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

const USER = 'apiuser'; // Or whatever they created
const PASS = 'Api12345!'; // Placeholder

async function run() {
  try {
    const http = axios.create({ baseURL: 'https://144.126.203.142:8043', httpsAgent: agent });
    const info = await http.get('/api/info');
    const cid = info.data.result.omadacId;
    console.log('Controller ID:', cid);

    const loginRes = await http.post(`/${cid}/api/v2/hotspot/login`, { username: USER, password: PASS });
    console.log('Hotspot Login Result:', loginRes.data);
  } catch (err) {
    console.error('Error:', err.message);
  }
}
run();
