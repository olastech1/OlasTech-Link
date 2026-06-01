const { redeemCode } = require('../../server/codes');
const omada = require('../../server/omada');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, clientMac, apMac, radioId } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'No code provided.' });
  }

  try {
    // Validate and mark code as used
    const result = await redeemCode(code, clientMac || 'unknown');

    // Grant access via Omada controller
    let omadaGranted = false;
    if (clientMac && apMac && process.env.OMADA_CONTROLLER_URL) {
      try {
        await omada.grantAccess({
          clientMac,
          apMac,
          radioId: radioId || '0',
          planId: result.planId,
        });
        omadaGranted = true;
        console.log(`[auth] Granted ${result.plan} access to ${clientMac}`);
      } catch (omadaErr) {
        // Log but don't fail the user — they can still see the success screen
        console.error('[omada]', omadaErr.message);
      }
    }

    res.json({
      success: true,
      plan: result.plan,
      planId: result.planId,
      duration_h: result.duration_h,
      data_mb: result.data_mb,
      sessionExpires: result.sessionExpires,
      omadaGranted,
      redirectUrl: process.env.REDIRECT_URL || 'https://www.google.com',
    });
  } catch (err) {
    console.error('[code/validate]', err.message);
    res.status(400).json({ error: err.message });
  }
};
