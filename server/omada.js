/**
 * omada.js — TP-Link Omada Controller API Client
 *
 * Designed for Vercel serverless: every exported function performs
 * a fresh login + action in one atomic call.  Module-level state cannot
 * be relied on between invocations on Vercel.
 *
 * Tested against Omada SDN Controller 5.15.x (apiVer 3).
 * Auth endpoint: POST /<cid>/api/v2/hotspot/login  { name, password }
 * Auth returns:  { errorCode:0, result:{ token: "…" } }
 * Access endpoint: POST /<cid>/api/v2/hotspot/extPortal/auth
 *   Headers: Cookie + Csrf-Token
 *   Body: { clientMac, apMac, ssidName, radioId, time, authType, site }
 */

const axios = require('axios');
const https = require('https');
require('dotenv').config();

const CONTROLLER_URL = process.env.OMADA_CONTROLLER_URL || 'https://192.168.1.1:8043';
const SITE_NAME      = process.env.OMADA_SITE_NAME      || 'Default';
const USERNAME       = process.env.OMADA_USERNAME        || 'admin';
const PASSWORD       = process.env.OMADA_PASSWORD        || 'admin';

// Allow self-signed certs on local Omada controllers
const agent = new https.Agent({ rejectUnauthorized: false });

const http = axios.create({
  baseURL: CONTROLLER_URL,
  httpsAgent: agent,
  timeout: 15000,
});

/**
 * Login to Omada.
 * Tries Hotspot Operator login first. If it fails due to account type, 
 * it falls back to Admin login.
 * Returns { cid, cookie, token } for use in subsequent calls.
 */
async function _login() {
  const infoRes = await http.get('/api/info');
  const cid = infoRes.data.result.omadacId;

  let loginRes;
  try {
    // 1. Try Hotspot Operator login
    loginRes = await http.post(`/${cid}/api/v2/hotspot/login`, {
      name: USERNAME,
      password: PASSWORD,
    });
    
    // If it fails, fallback to Admin login
    if (loginRes.data.errorCode !== 0) {
      loginRes = await http.post(`/${cid}/api/v2/login`, {
        username: USERNAME,
        password: PASSWORD,
      });
    }
  } catch (err) {
    // Fallback if the hotspot endpoint 404s or throws
    loginRes = await http.post(`/${cid}/api/v2/login`, {
      username: USERNAME,
      password: PASSWORD,
    });
  }

  if (loginRes.data.errorCode !== 0) {
    throw new Error(`Omada login failed: ${loginRes.data.msg || 'Invalid username or password.'}`);
  }

  // Extract cookie and CSRF token (both required for v5.0.15+)
  const cookies = loginRes.headers['set-cookie'];
  const cookie  = cookies ? cookies.map((c) => c.split(';')[0]).join('; ') : '';
  const token   = loginRes.data.result.token;

  return { cid, cookie, token };
}

async function _adminLogin() {
  const infoRes = await http.get('/api/info');
  const cid = infoRes.data.result.omadacId;

  const loginRes = await http.post(`/${cid}/api/v2/login`, {
    username: USERNAME,
    password: PASSWORD,
  });

  if (loginRes.data.errorCode !== 0) {
    throw new Error(`Omada admin login failed: ${loginRes.data.msg}`);
  }

  const cookies = loginRes.headers['set-cookie'];
  const cookie  = cookies ? cookies.map((c) => c.split(';')[0]).join('; ') : '';
  const token   = loginRes.data.result.token;

  return { cid, cookie, token };
}

/**
 * Authorize a client device for internet access.
 * Each call does a fresh login then immediately sends the auth command.
 */
async function authorizeClient({ clientMac, apMac, ssidName, radioId, duration }) {
  const { cid, cookie, token } = await _login();

  const payload = {
    clientMac,            // e.g. "AA-BB-CC-DD-EE-FF"
    apMac,                // e.g. "11-22-33-44-55-66"
    ssidName: ssidName || SITE_NAME,
    radioId: parseInt(radioId, 10) || 0,
    time: duration,       // in minutes
    authType: 4,          // 4 = External Portal auth
    site: SITE_NAME,
  };

  const res = await http.post(
    `/${cid}/api/v2/hotspot/extPortal/auth`,
    payload,
    { headers: { Cookie: cookie, 'Csrf-Token': token } }
  );

  // If we get back HTML instead of JSON, the path is wrong
  if (typeof res.data !== 'object') {
    throw new Error('Omada returned unexpected HTML — check extPortal/auth path');
  }

  if (res.data.errorCode !== 0) {
    throw new Error(`Omada auth failed: ${res.data.msg} (code ${res.data.errorCode})`);
  }

  return true;
}

/**
 * Convenience wrapper — authorizes with dynamic duration per plan.
 */
async function grantAccess({ clientMac, apMac, ssidName, radioId, duration_h }) {
  // If duration_h is null/undefined (unlimited), authorize for ~10 years
  const duration = duration_h ? duration_h * 60 : 5256000;

  await authorizeClient({ clientMac, apMac, ssidName, radioId, duration });

  return { duration };
}

/**
 * Get active client stats for data tracking.
 */
async function getClientStats() {
  const { cid, cookie, token } = await _adminLogin();

  // 1. Get all sites to find the exact siteId for SITE_NAME
  const sitesRes = await http.get(`/${cid}/api/v2/users/current`, {
    headers: { Cookie: cookie, 'Csrf-Token': token }
  });

  if (typeof sitesRes.data !== 'object' || sitesRes.data.errorCode !== 0) {
    throw new Error(`Failed to fetch sites: ${JSON.stringify(sitesRes.data)}`);
  }

  const sites = sitesRes.data.result.privilege.sites || [];
  const site = sites.find(s => s.name === SITE_NAME);
  if (!site) {
    throw new Error(`Site ${SITE_NAME} not found in Omada`);
  }
  const siteId = site.key || site.id;

  // 2. Fetch hotspot clients using the exact siteId to match the Omada Dashboard exactly
  const res = await http.get(
    `/${cid}/api/v2/hotspot/sites/${siteId}/clients`,
    { headers: { Cookie: cookie, 'Csrf-Token': token }, params: { currentPageSize: 9999, currentPage: 1 } }
  );

  if (typeof res.data !== 'object') {
    throw new Error('Omada returned unexpected HTML for clients API. Check permissions.');
  }
  
  if (res.data.errorCode !== 0) {
    throw new Error(`Omada clients API failed: ${res.data.msg} (code ${res.data.errorCode})`);
  }

  const allHotspotClients = res.data.result.data || [];
  // Only return valid (active) hotspot sessions to avoid picking up expired history
  return allHotspotClients.filter(c => c.valid === true);
}

/**
 * Disconnect / unauthorize a client who ran out of data.
 */
async function unauthorizeClient(clientMac) {
  const { cid, cookie, token } = await _login();

  const res = await http.post(
    `/${cid}/api/v2/sites/${encodeURIComponent(SITE_NAME)}/cmd/hotspot/unauth`,
    { mac: clientMac },
    { headers: { Cookie: cookie, 'Csrf-Token': token } }
  );

  return typeof res.data === 'object' && res.data.errorCode === 0;
}

/**
 * Create Native Omada Vouchers
 * Bypasses the custom external portal and tracks auth natively in Omada.
 */
async function createVouchers({ count = 1, duration_h, data_mb, devices = 1 }) {
  const { cid, cookie, token } = await _adminLogin();

  // 1. Get Site ID
  const sitesRes = await http.get(`/${cid}/api/v2/users/current`, {
    headers: { Cookie: cookie, 'Csrf-Token': token }
  });
  if (!sitesRes.data || sitesRes.data.errorCode !== 0) throw new Error('Failed to fetch sites for voucher generation.');
  const site = (sitesRes.data.result.privilege.sites || []).find(s => s.name === SITE_NAME);
  if (!site) throw new Error(`Site ${SITE_NAME} not found`);
  const siteId = site.key || site.id;

  // 2. Prepare payload
  const durationInMinutes = duration_h ? duration_h * 60 : 5256000; // ~10 years if unlimited
  
  const payload = {
    amount: count,
    codeLength: 8,
    duration: durationInMinutes,
    upLimitEnable: false,
    downLimitEnable: false,
    trafficLimitEnable: !!data_mb,
  };

  if (data_mb) {
    payload.trafficLimit = data_mb;
  }

  // Multi-use vs Single-use
  // Most v5 APIs use 'type: 1' for Multi-User and 'type: 0' for single user. 
  if (devices > 1) {
    payload.type = 1;
    payload.userLimit = devices; 
  } else {
    payload.type = 0; 
  }

  // 3. POST to create vouchers
  const res = await http.post(
    `/${cid}/api/v2/hotspot/sites/${siteId}/vouchers`,
    payload,
    { headers: { Cookie: cookie, 'Csrf-Token': token } }
  );

  if (res.data.errorCode !== 0) {
    throw new Error(`Omada failed to create voucher: ${res.data.msg}`);
  }

  // 4. Retrieve the newly created voucher codes
  // Omada returns the created vouchers usually in the result.data array
  const created = res.data.result.data || [];
  return created.map(v => v.code || v.voucherCode);
}

module.exports = { authorizeClient, grantAccess, getClientStats, unauthorizeClient, createVouchers };
