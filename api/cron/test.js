const axios = require('axios');
const https = require('https');

const CONTROLLER_URL = process.env.OMADA_CONTROLLER_URL || 'https://192.168.1.1:8043';
const SITE_NAME      = process.env.OMADA_SITE_NAME      || 'Default';
const USERNAME       = process.env.OMADA_USERNAME        || 'admin';
const PASSWORD       = process.env.OMADA_PASSWORD        || 'admin';

module.exports = async function (req, res) {
  try {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const client = axios.create({ baseURL: CONTROLLER_URL, httpsAgent: agent, timeout: 15000 });
    
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
    if (!site) throw new Error("Site not found: " + SITE_NAME);
    const siteId = site.key || site.id;

    const results = {};
    
    try {
      const r1 = await client.get(`/${cid}/api/v2/hotspot/sites/${siteId}/clients`, { headers: { Cookie: cookie, 'Csrf-Token': token }, params: { currentPageSize: 9999 } });
      results.hotspot_clients = r1.data.result.data || [];
    } catch(e) { results.hotspot_clients_err = e.message; }
    
    try {
      const r2 = await client.get(`/${cid}/api/v2/sites/${siteId}/clients`, { headers: { Cookie: cookie, 'Csrf-Token': token }, params: { currentPageSize: 9999 } });
      results.normal_clients = r2.data.result.data || [];
    } catch(e) { results.normal_clients_err = e.message; }

    try {
      const r3 = await client.get(`/${cid}/api/v2/sites/${siteId}/insight/clients`, { headers: { Cookie: cookie, 'Csrf-Token': token }, params: { currentPageSize: 9999 } });
      results.insight_clients = r3.data.result.data || [];
    } catch(e) { results.insight_clients_err = e.message; }

    res.json({
      siteId,
      hotspot_count: results.hotspot_clients ? results.hotspot_clients.length : 0,
      normal_count: results.normal_clients ? results.normal_clients.length : 0,
      insight_count: results.insight_clients ? results.insight_clients.length : 0,
      
      da03_hotspot: results.hotspot_clients ? results.hotspot_clients.find(c => c.mac.toUpperCase().includes('DA-03-AD-C5-62-4E')) : null,
      da03_normal: results.normal_clients ? results.normal_clients.find(c => c.mac.toUpperCase().includes('DA-03-AD-C5-62-4E')) : null,
      da03_insight: results.insight_clients ? results.insight_clients.find(c => c.mac.toUpperCase().includes('DA-03-AD-C5-62-4E')) : null,
      
      b7ef_hotspot: results.hotspot_clients ? results.hotspot_clients.find(c => c.mac.toUpperCase().includes('62-B7-EF-DB-95-67')) : null,
      b7ef_normal: results.normal_clients ? results.normal_clients.find(c => c.mac.toUpperCase().includes('62-B7-EF-DB-95-67')) : null,
      b7ef_insight: results.insight_clients ? results.insight_clients.find(c => c.mac.toUpperCase().includes('62-B7-EF-DB-95-67')) : null,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
};
