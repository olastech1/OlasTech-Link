/**
 * omada.js — TP-Link Omada Controller API Client
 * Authenticates with the Omada controller and authorizes
 * a client device for internet access.
 *
 * Docs: Omada SDN Controller API Guide (v5.x)
 * https://www.tp-link.com/en/support/download/omada-software-controller/
 *
 * IMPORTANT: The Omada controller uses self-signed TLS certificates.
 * We disable SSL verification for local connections (not for production).
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

const omadaHttp = axios.create({
  baseURL: CONTROLLER_URL,
  httpsAgent: agent,
  timeout: 10000,
});

let sessionCookie = null;
let omadaControllerId = null;
let omadaCsrfToken = null;

/**
 * Login to Omada Controller. Returns controller ID (needed for all API calls).
 */
async function login() {
  // Step 1: Get controller info
  const infoRes = await omadaHttp.get('/api/info');
  omadaControllerId = infoRes.data.result.omadacId;

  // Step 2: Login using standard admin endpoint
  const loginRes = await omadaHttp.post(`/${omadaControllerId}/api/v2/hotspot/login`, {
    name: USERNAME, // Hotspot Operator uses 'name', not 'username'
    password: PASSWORD,
  });

  if (loginRes.data.errorCode !== 0) {
    throw new Error(`Omada login failed: ${loginRes.data.msg}`);
  }

  // Extract CSRF Token (Required in Omada 5.0.15+)
  omadaCsrfToken = loginRes.data.result.token;

  // Store session cookie
  const cookies = loginRes.headers['set-cookie'];
  sessionCookie = cookies ? cookies.map((c) => c.split(';')[0]).join('; ') : null;

  return omadaControllerId;
}

/**
 * Authorize a client device for internet access.
 *
 * @param {string} clientMac  - Client MAC address (from Omada URL params)
 * @param {string} apMac      - AP MAC address (from Omada URL params)
 * @param {string} radioId    - Radio ID (from Omada URL params)
 * @param {number} duration   - Duration in minutes
 * @param {number} [limitDown] - Download limit in KB/s (optional)
 * @param {number} [limitUp]   - Upload limit in KB/s (optional)
 */
async function authorizeClient({ clientMac, apMac, radioId, duration, limitDown, limitUp }) {
  // Ensure logged in
  if (!sessionCookie || !omadaControllerId) {
    await login();
  }

  const payload = {
    mac: clientMac,
    ap: apMac,
    radioId: parseInt(radioId, 10) || 0,
    ssidIndex: 0,
    time: duration,           // in minutes
    ...(limitDown && { limitDown }),
    ...(limitUp   && { limitUp }),
  };

  // Omada v5 requires the 'site' parameter in the body, not the URL
  payload.site = SITE_NAME;
  payload.ssidName = payload.ssidName || 'OlasTech Hotspot';

  const res = await omadaHttp.post(
    `/${omadaControllerId}/api/v2/hotspot/extPortal/auth`,
    payload,
    { headers: { Cookie: sessionCookie, 'Csrf-Token': omadaCsrfToken } }
  );

  if (res.data.errorCode !== 0) {
    // Session may have expired — retry once after re-login
    if (res.data.errorCode === -1006 || res.data.errorCode === -30109) {
      sessionCookie = null;
      await login();
      return authorizeClient({ clientMac, apMac, radioId, duration, limitDown, limitUp });
    }
    throw new Error(`Omada auth failed: ${res.data.msg}`);
  }

  return true;
}

/**
 * Convenience wrapper — authorizes with duration limits per plan.
 */
async function grantAccess({ clientMac, apMac, radioId, planId }) {
  const limits = {
    '300gb':   { duration: 720 * 60 },
    '250gb':   { duration: 720 * 60 },
    '150gb':   { duration: 720 * 60 },
    '110gb':   { duration: 720 * 60 },
    '50gb':    { duration: 720 * 60 },
    'weekend': { duration: 48 * 60 },
    'daily':   { duration: 24 * 60 },
  };

  const { duration } = limits[planId] || limits['daily'];

  await authorizeClient({
    clientMac,
    apMac,
    radioId,
    duration,
  });

  return { duration };
}

/**
 * Get active client stats for data tracking
 * Returns array of clients: { mac, rxBytes, txBytes, trafficDown, trafficUp }
 */
async function getClientStats() {
  if (!sessionCookie || !omadaControllerId) await login();

  const res = await omadaHttp.get(
    `/${omadaControllerId}/api/v2/sites/${encodeURIComponent(SITE_NAME)}/clients`,
    { headers: { Cookie: sessionCookie }, params: { currentPageSize: 9999 } }
  );

  if (res.data.errorCode !== 0) {
    if (res.data.errorCode === -1006 || res.data.errorCode === -30109) {
      sessionCookie = null;
      await login();
      return getClientStats();
    }
    return [];
  }

  return res.data.result.data || [];
}

/**
 * Disconnect/Unauthorize a client who ran out of data
 */
async function unauthorizeClient(clientMac) {
  if (!sessionCookie || !omadaControllerId) await login();

  const res = await omadaHttp.post(
    `/${omadaControllerId}/api/v2/sites/${encodeURIComponent(SITE_NAME)}/cmd/hotspot/unauth`,
    { mac: clientMac },
    { headers: { Cookie: sessionCookie } }
  );

  return res.data.errorCode === 0;
}

module.exports = { login, authorizeClient, grantAccess, getClientStats, unauthorizeClient };
