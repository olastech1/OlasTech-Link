const db = require('../../server/db');
module.exports = async function(req, res) {
  try {
    await db.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS time_used BIGINT DEFAULT 0');
    await db.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity_time BIGINT DEFAULT 0');
    res.json({success: true});
  } catch(e) {
    res.json({error: e.message});
  }
}
