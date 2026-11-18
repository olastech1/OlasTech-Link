const axios = require('axios');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });

class OmadaAPI {
  constructor() {
    this.baseURL = process.env.OMADA_CONTROLLER_URL;
    this.http = axios.create({ baseURL: this.baseURL, httpsAgent: agent });
    this.omadacId = null;
    this.token = null;
    this.siteId = null;
  }

  async login() {
    try {
      // Drop any stale session so the login request starts clean
      delete this.http.defaults.headers.common['Cookie'];
      const infoResp = await this.http.get('/api/info');
      this.omadacId = infoResp.data.result.omadacId;

      const loginResp = await this.http.post(`/${this.omadacId}/api/v2/login`, {
        username: process.env.OMADA_USERNAME,
        password: process.env.OMADA_PASSWORD
      });
      
      if (loginResp.data.errorCode !== 0) {
          console.error("Omada Login Failed:", loginResp.data);
          return false;
      }
      
      this.token = loginResp.data.result.token;
      
      // Extract cookies and set them for all subsequent requests
      // Keep only "name=value" from each Set-Cookie (drop Path/HttpOnly attributes)
      const cookies = loginResp.headers['set-cookie'];
      if (cookies) {
         this.http.defaults.headers.common['Cookie'] = cookies.map(c => c.split(';')[0]).join('; ');
      }

      // Get Site ID - try current user's sites first
      let sites = [];
      
      // Try the user privilege sites endpoint (works for non-admin users)
      try {
        const privSitesResp = await this.http.get(`/${this.omadacId}/api/v2/users/current/sites?currentPage=1&currentPageSize=100`, {
          headers: { 'Csrf-Token': this.token }
        });
        if (privSitesResp.data.errorCode === 0 && privSitesResp.data.result.data && privSitesResp.data.result.data.length > 0) {
          sites = privSitesResp.data.result.data;
        }
      } catch (e) {
        console.log('Privilege sites endpoint failed, trying regular sites...');
      }
      
      // Fallback to regular sites endpoint with pagination
      if (sites.length === 0) {
        const sitesResp = await this.http.get(`/${this.omadacId}/api/v2/sites?currentPage=1&currentPageSize=100`, {
          headers: { 'Csrf-Token': this.token }
        });
        if (sitesResp.data.errorCode === 0 && sitesResp.data.result.data) {
          sites = sitesResp.data.result.data;
        }
      }

      if (sites.length === 0) {
        console.error('Omada: No sites found');
        return false;
      }
      
      // Never fall back to another site: vouchers on the wrong site don't work on the hotspot.
      const targetSite = sites.find(s => s.name === process.env.OMADA_SITE);
      if (!targetSite) {
        console.error(`Omada: site "${process.env.OMADA_SITE}" not found. Available: ${sites.map(s => s.name).join(', ')}`);
        return false;
      }
      this.siteId = targetSite.id;
      console.log('Omada site found:', targetSite.name, 'ID:', this.siteId);

      return true;
    } catch (error) {
      console.error('Omada Login Error:', error.message);
      return false;
    }
  }

  // Look up a voucher group's ID by its (unique) name.
  async _findGroupId(name) {
    const resp = await this.http.get(`/${this.omadacId}/api/v2/hotspot/sites/${this.siteId}/voucherGroups?currentPage=1&currentPageSize=100&searchKey=${encodeURIComponent(name)}`, {
      headers: { 'Csrf-Token': this.token }
    });
    if (!resp.data || resp.data.errorCode !== 0) return null;
    const group = (resp.data.result.data || []).find(g => g.name === name);
    return group ? group.id : null;
  }

  /**
   * Create a single-code voucher group and return the code that belongs to THAT group.
   * Retries up to 3 times with a fresh login; never creates a second group once one exists.
   */
  async createVoucher(planId, dataLimitMB, durationHours, devices) {
    const name = `TG_${planId}_${Date.now()}`;
    const reqBody = {
      name,
      applyToAllPortals: true,
      voucherValidityEnable: false,
      codeForm: 0,
      amount: 1,
      codeLength: 8,
      type: dataLimitMB > 0 ? 2 : 1, // 1: time limited, 2: time+data limited
      maxUsers: devices,
      note: `Bot-Gen: ${planId}`,
      duration: durationHours * 60, // minutes
      durationType: 1,
      upTimeLimitEnable: false,
      trafficLimitEnable: dataLimitMB > 0,
      trafficLimit: dataLimitMB > 0 ? dataLimitMB : undefined,
      trafficLimitFrequency: 0
    };

    let groupId = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!(await this.login())) throw new Error('Omada login failed');
        const groupsPath = `/${this.omadacId}/api/v2/hotspot/sites/${this.siteId}/voucherGroups`;

        // A previous attempt may have created the group before failing.
        if (!groupId && attempt > 1) groupId = await this._findGroupId(name);

        if (!groupId) {
          console.log(`[voucher] attempt ${attempt}: creating group`, JSON.stringify(reqBody));
          const createResp = await this.http.post(groupsPath, reqBody, { headers: { 'Csrf-Token': this.token } });
          const data = createResp.data;
          if (typeof data !== 'object' || data.errorCode !== 0) {
            throw new Error('Create group rejected: ' + (typeof data === 'object' ? JSON.stringify(data) : 'HTML response (session not accepted)'));
          }
          const r = data.result;
          groupId = (typeof r === 'string' && r) || (r && (r.id || r.voucherGroupId)) || await this._findGroupId(name);
          if (!groupId) throw new Error('Group created but its ID could not be found');
        }

        const vResp = await this.http.get(`${groupsPath}/${groupId}?currentPage=1&currentPageSize=10`, { headers: { 'Csrf-Token': this.token } });
        const rows = vResp.data && vResp.data.errorCode === 0 ? (vResp.data.result.data || []) : [];
        if (rows.length > 0 && rows[0].code) {
          console.log(`[voucher] group ${name} (${groupId}) -> code issued`);
          return rows[0].code;
        }
        throw new Error('Group has no vouchers yet: ' + JSON.stringify(vResp.data).slice(0, 200));
      } catch (error) {
        console.error(`[voucher] attempt ${attempt} failed:`, error.response ? JSON.stringify(error.response.data).slice(0, 300) : error.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    return null;
  }

  async getVoucherBalance(code, retried = false) {
    if (!this.token) await this.login();

    try {
      // Find voucher by code
      const response = await this.http.get(`/${this.omadacId}/api/v2/hotspot/sites/${this.siteId}/vouchers?currentPage=1&currentPageSize=10&searchKey=${code}`, {
        headers: { 'Csrf-Token': this.token }
      });

      if (response.data.errorCode === 0 && response.data.result && response.data.result.data) {
         const vouchers = response.data.result.data;
         const v = vouchers.find(x => x.code === code);
         if (v) {
             let status = 0; // Unused
             if (!v.valid) status = 2; // Expired/Invalid
             else if (v.used > 0 || v.trafficUsed > 0) status = 1; // Active

             return {
                 quota: v.trafficLimit || 0, // in MB
                 used: v.trafficUsed || 0,   // in Bytes
                 duration: v.duration || 0,
                 status: status
             };
         }
      }
      // Session may have expired: log in again once and retry
      if (!retried && (typeof response.data !== 'object' || response.data.errorCode !== 0)) {
        if (await this.login()) return this.getVoucherBalance(code, true);
      }
      return null;
    } catch (error) {
      console.error('Voucher Balance Error:', error.message);
      if (!retried && (await this.login())) return this.getVoucherBalance(code, true);
      return null;
    }
  }
}

module.exports = new OmadaAPI();
