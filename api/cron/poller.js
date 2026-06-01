const db = require('../../server/db');
const omada = require('../../server/omada');
const mailer = require('../../server/mailer');

module.exports = async function (req, res) {
  // Can be called via GET or POST
  
  if (!process.env.OMADA_CONTROLLER_URL) {
    return res.status(200).json({ status: 'skipped', reason: 'No Omada Configured' });
  }

  try {
    const activeCodesRes = await db.query(`
      SELECT c.code, c.data_mb, c.email 
      FROM access_codes c
      WHERE c.status != 'expired' AND c.data_mb IS NOT NULL
    `);

    const activeCodes = activeCodesRes.rows;

    if (activeCodes.length === 0) {
      return res.status(200).json({ status: 'ok', codesProcessed: 0 });
    }

    const clients = await omada.getClientStats();
    if (!clients || clients.length === 0) {
      return res.status(200).json({ status: 'ok', message: 'No connected clients found.' });
    }

    for (const codeObj of activeCodes) {
      // Get all active sessions for this code
      const sessionsRes = await db.query(`
        SELECT id, client_mac, data_used, notified_200mb 
        FROM sessions 
        WHERE code = $1 AND expires_at > CURRENT_TIMESTAMP
      `, [codeObj.code]);
      
      const sessions = sessionsRes.rows;

      if (sessions.length === 0) continue;

      let totalUsedForCodeMB = 0;
      let anyNotified = false;

      for (const session of sessions) {
        const clientStat = clients.find(c => c.mac.toLowerCase() === session.client_mac.toLowerCase());
        
        let sessionUsedMB = session.data_used || 0;
        
        if (clientStat) {
          const totalTrafficBytes = (clientStat.trafficDown || 0) + (clientStat.trafficUp || 0);
          sessionUsedMB = totalTrafficBytes / (1024 * 1024);
          
          // Update this session's usage
          await db.query('UPDATE sessions SET data_used = $1 WHERE id = $2', [sessionUsedMB, session.id]);
        }
        
        totalUsedForCodeMB += sessionUsedMB;
        if (session.notified_200mb === 1) anyNotified = true;
      }

      const remainingMB = codeObj.data_mb - totalUsedForCodeMB;

      // Check if exhausted
      if (remainingMB <= 0) {
        console.log(`[poller] Code ${codeObj.code} data exhausted. Kicking ${sessions.length} devices.`);
        
        for (const session of sessions) {
          await omada.unauthorizeClient(session.client_mac);
          await db.query('UPDATE sessions SET expires_at = CURRENT_TIMESTAMP WHERE id = $1', [session.id]);
        }
        await db.query(`UPDATE access_codes SET status = 'expired' WHERE code = $1`, [codeObj.code]);

        if (codeObj.email) {
          mailer.sendDepletionEmail(codeObj.email);
        }
        continue;
      }

      // Check 200MB threshold
      if (remainingMB <= 200 && !anyNotified) {
        console.log(`[poller] Code ${codeObj.code} has ${remainingMB.toFixed(1)}MB left. Sending warning.`);
        
        for (const session of sessions) {
          await db.query('UPDATE sessions SET notified_200mb = 1 WHERE id = $1', [session.id]);
        }
        
        if (codeObj.email) {
          mailer.sendWarningEmail(codeObj.email, remainingMB);
        }
      }
    }
    
    return res.status(200).json({ status: 'ok', codesProcessed: activeCodes.length });
  } catch (err) {
    console.error('[poller] Error checking data usage:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
