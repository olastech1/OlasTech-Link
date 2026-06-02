const db = require('../../server/db');
const { getClientStats, unauthorizeClient } = require('../../server/omada');

module.exports = async function (req, res) {
  // Only allow GET or POST.
  // Protect endpoint with ADMIN_KEY or a specific cron token
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== process.env.ADMIN_KEY && key !== 'sync_olastech_2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Load all dynamic plans
    const plansRes = await db.query('SELECT * FROM plans');
    const plansMap = {};
    for (const p of plansRes.rows) plansMap[p.id] = p;

    // 1. Get all active sessions
    const activeSessionsRes = await db.query(`
      SELECT * FROM sessions 
      WHERE expires_at > CURRENT_TIMESTAMP
      ORDER BY started_at DESC
    `);
    
    const activeSessions = activeSessionsRes.rows;
    if (activeSessions.length === 0) {
      return res.json({ success: true, message: 'No active sessions to sync.' });
    }

    // 2. Fetch live data from Omada
    const clients = await getClientStats();
    if (!clients || clients.length === 0) {
      return res.json({ success: true, message: 'No clients found in Omada.' });
    }

    // Normalize MACs to just uppercase alphanumeric
    const formatMac = (m) => (m || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    // Map Omada clients by normalized MAC
    const omadaClients = {};
    for (const c of clients) {
      if (c.mac) omadaClients[formatMac(c.mac)] = c;
    }

    // 3. Identify the most recent active session for each MAC
    const latestSessionsByMac = {};
    for (const session of activeSessions) {
      const mac = formatMac(session.client_mac);
      if (!latestSessionsByMac[mac]) {
        latestSessionsByMac[mac] = session;
      }
    }

    // 4. Process each unique session
    let updated = 0;
    let disconnected = 0;

    for (const mac in latestSessionsByMac) {
      const session = latestSessionsByMac[mac];
      const omadaClient = omadaClients[mac];
      
      if (!omadaClient) continue; // Client is not currently connected to WiFi

      // Calculate bytes used
      const currentActivity = (omadaClient.download || 0) + (omadaClient.upload || 0);
      const lastActivity = parseFloat(session.last_activity_bytes || 0);

      let deltaBytes = 0;
      if (currentActivity >= lastActivity) {
        deltaBytes = currentActivity - lastActivity;
      } else {
        // Counter reset (e.g. they disconnected and reconnected)
        deltaBytes = currentActivity;
      }

      // Calculate time used
      const currentDuration = parseFloat(omadaClient.duration || 0);
      const lastDuration = parseFloat(session.last_activity_time || 0);

      let deltaSeconds = 0;
      if (currentDuration >= lastDuration) {
        deltaSeconds = currentDuration - lastDuration;
      } else {
        // Counter reset (new connection session started in Omada)
        deltaSeconds = currentDuration;
      }

      if (deltaBytes === 0 && deltaSeconds === 0) continue;

      const deltaMb = deltaBytes / (1024 * 1024);
      const newUsedMb = parseFloat(session.data_used) + deltaMb;
      const newUsedTime = parseFloat(session.time_used || 0) + deltaSeconds;
      
      // Update DB
      await db.query(`
        UPDATE sessions 
        SET data_used = $1, last_activity_bytes = $2, time_used = $3, last_activity_time = $4
        WHERE id = $5
      `, [newUsedMb, currentActivity, newUsedTime, currentDuration, session.id]);
      
      updated++;

      // 5. Check Limits
      const plan = plansMap[session.plan_id];
      const maxSeconds = plan ? plan.duration_h * 3600 : 0;
      
      const exceededData = plan && plan.data_mb && newUsedMb >= plan.data_mb;
      const exceededTime = maxSeconds > 0 && newUsedTime >= maxSeconds;

      if (exceededData || exceededTime) {
        // Unauthorize from Omada
        await unauthorizeClient(omadaClient.mac);
        
        // Mark session as expired
        await db.query(`
          UPDATE sessions SET expires_at = CURRENT_TIMESTAMP WHERE id = $1
        `, [session.id]);
        
        disconnected++;
      }
    }

    res.json({ success: true, updated, disconnected });

  } catch (err) {
    console.error('[cron/sync] Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
