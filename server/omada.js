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
 * Login to Omada as a Hotspot Operator.
 * Returns { cid, cookie, token } for use in subsequent calls.
 */
async function _login() {
  // 1. Get controller ID
  const infoRes = await http.get('/api/info');
  const cid = infoRes.data.result.omadacId;

  // 2. Login as Hotspot Operator
  const loginRes = await http.post(`/${cid}/api/v2/hotspot/login`, {
    name: USERNAME,
    password: PASSWORD,
  });

  if (loginRes.data.errorCode !== 0) {
    throw new Error(`Omada login failed: ${loginRes.data.msg}`);
  }

  // 3. Extract cookie and CSRF token (both required for v5.0.15+)
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
 * Convenience wrapper — authorizes with duration limits per plan.
 */
async function grantAccess({ clientMac, apMac, ssidName, radioId, planId }) {
  const limits = {
    '300gb':   { duration: 87600 * 60 },
    '250gb':   { duration: 87600 * 60 },
    '150gb':   { duration: 87600 * 60 },
    '110gb':   { duration: 87600 * 60 },
    '50gb':    { duration: 87600 * 60 },
    'weekend': { duration: 48 * 60 },
    'daily':   { duration: 24 * 60 },
  };

  const { duration } = limits[planId] || limits['daily'];

  await authorizeClient({ clientMac, apMac, ssidName, radioId, duration });

  return { duration };
}

/**
 * Get active client stats for data tracking.
 */
async function getClientStats() {
  const { cid, cookie, token } = await _login();

  const res = await http.get(
    `/${cid}/api/v2/sites/${encodeURIComponent(SITE_NAME)}/clients`,
    { headers: { Cookie: cookie, 'Csrf-Token': token }, params: { currentPageSize: 9999 } }
  );

  if (typeof res.data !== 'object') {
    throw new Error('Omada returned unexpected HTML for clients API');
  }
  
  if (res.data.errorCode !== 0) {
    throw new Error(`Omada clients API failed: ${res.data.msg} (code ${res.data.errorCode})`);
  }

  return res.data.result.data || [];
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

module.exports = { authorizeClient, grantAccess, getClientStats, unauthorizeClient };
