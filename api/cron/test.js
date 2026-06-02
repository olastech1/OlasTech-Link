const db = require('../../server/db');
const { _adminLogin, http, SITE_NAME } = require('../../server/omada');
const axios = require('axios');
const https = require('https');

const CONTROLLER_URL = process.env.OMADA_CONTROLLER_URL;
const USERNAME = process.env.OMADA_USERNAME;
const PASSWORD = process.env.OMADA_PASSWORD;

module.exports = async function (req, res) {
  try {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const client = axios.create({ baseURL: CONTROLLER_URL, httpsAgent: agent });
    
    // login
    const infoRes = await client.get('/api/info');
    const cid = infoRes.data.result.omadacId;
    const loginRes = await client.post(`/${cid}/api/v2/login`, { username: USERNAME, password: PASSWORD });
    const cookies = loginRes.headers['set-cookie'];
    const cookie = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';
    const token = loginRes.data.result.token;
    
    const sitesRes = await client.get(`/${cid}/api/v2/users/current`, { headers: { Cookie: cookie, 'Csrf-Token': token } });
    const sites = sitesRes.data.result.privilege.sites || [];
    const site = sites.find(s => s.name === SITE_NAME);
    const siteId = site.key || site.id;

    // Try a few endpoints to find the realtime hotspot clients
    const results = {};
    
    try {
      const r1 = await client.get(`/${cid}/api/v2/sites/${siteId}/hotspot/clients`, { headers: { Cookie: cookie, 'Csrf-Token': token }, params: { currentPageSize: 10 } });
      results.hotspot_clients = r1.data;
    } catch(e) { results.hotspot_clients_err = e.message; }
    
    try {
      const r2 = await client.get(`/${cid}/api/v2/sites/${siteId}/clients`, { headers: { Cookie: cookie, 'Csrf-Token': token }, params: { currentPageSize: 10 } });
      results.normal_clients = r2.data;
    } catch(e) { results.normal_clients_err = e.message; }

    res.json(results);
  } catch (e) {
    res.json({ error: e.message });
  }
};
