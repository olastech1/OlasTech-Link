const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

async function run() {
  const http = axios.create({ baseURL: 'https://144.126.203.142:8043', httpsAgent: agent });
  const info = await http.get('/api/info');
  const cid = info.data.result.omadacId;
  
  // Login
  const loginRes = await http.post(`/${cid}/api/v2/login`, { username: 'olastech', password: process.env.OMADA_PASS || 'olastech123' }); // Guessing password or wait, I don't know it!
  // I CAN'T TEST THIS BECAUSE I DON'T KNOW THE PASSWORD!
}
run();
