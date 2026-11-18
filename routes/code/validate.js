const { redeemCode } = require('../../server/codes');
const omada = require('../../server/omada');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, clientMac, apMac, radioId, ssidName } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'No code provided.' });
  }

  try {
    // We no longer authorize via External Web Portal.
    // Native Omada Vouchers must be entered directly on the Omada Wi-Fi login page.
    throw new Error('This is an Omada Native Voucher. Please connect to the Wi-Fi network and enter this code on the Wi-Fi login screen.');
  } catch (err) {
    console.error('[code/validate]', err.message);
    res.status(400).json({ error: err.message });
  }
};
