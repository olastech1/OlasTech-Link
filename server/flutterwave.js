const https = require('https');

/**
 * Very payment with Flutterwave
 * 
 * @param {string} transactionId - The Flutterwave transaction ID
 * @returns {Promise<Object>} The verified transaction data
 */
function verifyPayment(transactionId) {
  return new Promise((resolve, reject) => {
    const secretKey = process.env.FLW_SECRET_KEY;
    if (!secretKey) return reject(new Error('FLW_SECRET_KEY is missing'));

    const options = {
      hostname: 'api.flutterwave.com',
      port: 443,
      path: `/v3/transactions/${transactionId}/verify`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status === 'success' && parsed.data.status === 'successful') {
            resolve(parsed.data);
          } else {
            reject(new Error(parsed.message || 'Transaction was not successful'));
          }
        } catch (e) {
          reject(new Error('Failed to parse Flutterwave response'));
        }
      });
    });

    req.on('error', error => { reject(error); });
    req.end();
  });
}

module.exports = {
  verifyPayment
};
