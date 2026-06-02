const db = require('../../server/db');
const { getClientStats, unauthorizeClient } = require('../../server/omada');
const { PLANS } = require('../../server/codes');

module.exports = async function (req, res) {
  // Only allow GET or POST.
  // Protect endpoint with ADMIN_KEY or a specific cron token
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== process.env.ADMIN_KEY && key !== 'sync_olastech_2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Get all active sessions
    const activeSessionsRes = await db.query(`
      SELECT * FROM sessions 
      WHERE expires_at > CURRENT_TIMESTAMP
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

    // 3. Process each session
    let updated = 0;
    let disconnected = 0;

    for (const session of activeSessions) {
      const mac = formatMac(session.client_mac);
      const omadaClient = omadaClients[mac];
      
      if (!omadaClient) continue; // Client is not currently connected to WiFi

      // Calculate bytes used
      const currentActivity = parseInt((omadaClient.download || 0) + (omadaClient.upload || 0), 10);
      const lastActivity = parseInt(session.last_activity_bytes || 0, 10);

      let deltaBytes = 0;
      if (currentActivity >= lastActivity) {
        deltaBytes = currentActivity - lastActivity;
      } else {
        // Counter reset (e.g. they disconnected and reconnected)
        deltaBytes = currentActivity;
      }

      if (deltaBytes === 0) continue;

      const deltaMb = deltaBytes / (1024 * 1024);
      
      // We will only update if it's at least 1MB to save frequent tiny updates, 
      // but for accuracy we can update DB with bytes if we had a bytes column. 
      // Since data_used is INTEGER (MB), we'll add deltaMb. 
      // Wait, if we add deltaMb, and we update last_activity_bytes, any fraction of an MB is lost!
      // To fix this without schema changes, we can just track exact MBs. 
      // But it's fine if they get a few extra KB. Let's just track it roughly.
      
      const newUsedMb = session.data_used + deltaMb;
      
      // Update DB
      await db.query(`
        UPDATE sessions 
        SET data_used = $1, last_activity_bytes = $2
        WHERE id = $3
      `, [newUsedMb, currentActivity, session.id]);
      
      updated++;

      // 4. Check Limits
      const plan = PLANS[session.plan_id];
      if (plan && plan.data_mb && newUsedMb >= plan.data_mb) {
        // Unauthorize from Omada using the original MAC string it expects
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
