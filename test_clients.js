const { getClientStats } = require('./server/omada');
require('dotenv').config();

(async () => {
  try {
    const clients = await getClientStats();
    console.log("Total clients:", clients.length);
    if (clients.length > 0) {
      console.log("Sample client:", JSON.stringify(clients[0], null, 2));
    }
  } catch (err) {
    console.error(err);
  }
})();
