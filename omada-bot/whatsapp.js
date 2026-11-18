// WhatsApp Cloud API (official Meta platform) helpers.
const axios = require('axios');
const crypto = require('crypto');

const GRAPH_VERSION = process.env.WA_GRAPH_VERSION || 'v23.0';

function enabled() {
  return !!(process.env.WA_PHONE_NUMBER_ID && process.env.WA_ACCESS_TOKEN);
}

async function send(to, message) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WA_PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message }, {
      headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` },
      timeout: 15000
    });
    return true;
  } catch (err) {
    console.error('[wa] send failed:', err.response ? JSON.stringify(err.response.data).slice(0, 300) : err.message);
    return false;
  }
}

function sendText(to, body) {
  return send(to, { type: 'text', text: { preview_url: true, body } });
}

/** Interactive list (max 10 rows; title <= 24 chars, description <= 72). */
function sendList(to, { body, button, rows }) {
  return send(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: { button: button.slice(0, 20), sections: [{ title: 'Plans', rows: rows.slice(0, 10) }] }
    }
  });
}

/** Check Meta's X-Hub-Signature-256 header against the raw request body. */
function validSignature(req) {
  const secret = process.env.WA_APP_SECRET;
  const header = req.get('x-hub-signature-256') || '';
  if (!secret || !req.rawBody || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Flatten a webhook payload into simple incoming messages. */
function parseMessages(body) {
  const out = [];
  for (const entry of (body && body.entry) || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const names = {};
      for (const c of value.contacts || []) names[c.wa_id] = c.profile && c.profile.name;
      for (const m of value.messages || []) {
        let text = '', replyId = null;
        if (m.type === 'text') text = (m.text && m.text.body) || '';
        else if (m.type === 'interactive' && m.interactive) {
          const r = m.interactive.list_reply || m.interactive.button_reply || {};
          replyId = r.id || null; text = r.title || '';
        } else if (m.type === 'button' && m.button) { text = m.button.text || ''; replyId = m.button.payload || null; }
        out.push({ id: m.id, from: m.from, name: names[m.from], text: text.trim(), replyId });
      }
    }
  }
  return out;
}

module.exports = { enabled, sendText, sendList, validSignature, parseMessages };
