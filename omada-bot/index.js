require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const omada = require('./omada');
const wa = require('./whatsapp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
// Keep the raw body so WhatsApp webhook signatures can be checked.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '+234 816 274 7882';
const TELEGRAM_URL = 'https://t.me/Olastech_bot';
const WA_CHAT_URL = process.env.WA_DISPLAY_NUMBER ? `https://wa.me/${process.env.WA_DISPLAY_NUMBER}` : null;

// hidden: no longer sold, but kept so older orders for it can still be fulfilled.
const plans = {
  '50gb': { name: '50GB', price: 5000, duration_h: 720, data_mb: 51200, devices: 4 },
  'weekend': { name: 'Weekend Unlimited', short: 'Weekend', price: 10000, duration_h: 48, data_mb: 0, devices: 5 },
  '110gb': { name: '110GB', price: 12000, duration_h: 720, data_mb: 112640, devices: 4 },
  '150gb': { name: '150GB', price: 15000, duration_h: 720, data_mb: 153600, devices: 4 },
  '250gb': { name: '250GB', price: 20000, duration_h: 720, data_mb: 256000, devices: 5 },
  '300gb': { name: '300GB', price: 35000, duration_h: 720, data_mb: 307200, devices: 10 },
  'daily': { name: 'Daily Unlimited', price: 3000, duration_h: 24, data_mb: 0, devices: 3, hidden: true },
};
const forSale = () => Object.entries(plans).filter(([, p]) => !p.hidden);
const naira = n => `₦${n.toLocaleString('en-NG')}`;
const planDetail = p => `${p.duration_h >= 720 ? `${p.duration_h / 24} days` : `${p.duration_h} hours`} · ${p.devices} devices`;

// ---- Persistent payment store -------------------------------------------
// Survives restarts so a payment made while the bot restarts still gets its voucher.
const STORE_FILE = process.env.TX_STORE_FILE || path.join(__dirname, 'transactions.json');
let txs = {};
try { txs = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch (e) { txs = {}; }

function saveTxs() {
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(txs, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

// ---- Messaging per channel ----------------------------------------------
const messages = {
  paid: p => `Payment confirmed. Generating your ${p.name} code, please wait…`,
  code: (p, code) => ({
    telegram: `*Your Wi-Fi code is ready*\n\nCode: \`${code}\`\nPlan: ${p.name}\nDevices: ${p.devices}\n\nConnect to OlasTech Wi-Fi and enter this code on the login page.`,
    whatsapp: `*Your Wi-Fi code is ready*\n\nCode: *${code}*\nPlan: ${p.name}\nDevices: ${p.devices}\n\nConnect to OlasTech Wi-Fi and enter this code on the login page.`
  }),
  delayed: ref => `Your payment was received, but generating your code is taking longer than usual. We are retrying automatically and will send it here. Reference: ${ref}`
};

async function notify(tx, text) {
  if (tx.channel === 'link' || tx.channel === 'manual') return; // shown on the order page / sent by the admin
  const body = typeof text === 'object' ? text[tx.channel || 'telegram'] : text;
  try {
    if ((tx.channel || 'telegram') === 'whatsapp') await wa.sendText(tx.waId, body);
    else await bot.telegram.sendMessage(tx.chatId, body, typeof text === 'object' ? { parse_mode: 'Markdown' } : {});
  } catch (err) {
    console.error('[notify] failed:', err.message);
  }
}

// ---- Payments -----------------------------------------------------------
async function createInvoice({ channel, userId, name, planId, returnRef }) {
  const plan = plans[planId];
  if (!plan || plan.hidden) throw new Error(`Unknown plan ${planId}`);
  // Payment-link refs are also the customer's order-page address, so make them unguessable.
  const tx_ref = channel === 'link'
    ? `OlasTech-L-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
    : `OlasTech-${channel === 'whatsapp' ? 'WA-' : ''}${Date.now()}-${userId}`;
  const response = await axios.post('https://api.flutterwave.com/v3/payments', {
    tx_ref,
    amount: plan.price,
    currency: 'NGN',
    redirect_url: `${process.env.BASE_URL}/callback`,
    customer: { email: `${userId}@olastech.com`, name: name || 'Customer' },
    customizations: { title: 'OlasTech Wi-Fi', description: `Payment for ${plan.name} Wi-Fi Plan` }
  }, { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } });

  if (response.data.status !== 'success') throw new Error('Flutterwave did not return a payment link');
  const base = { channel, planId, amount: plan.price, status: 'pending', createdAt: Date.now() };
  txs[tx_ref] = channel === 'whatsapp' ? { ...base, waId: userId } : channel === 'telegram' ? { ...base, chatId: userId } : base;
  saveTxs();
  return returnRef ? { link: response.data.data.link, tx_ref } : response.data.data.link;
}

async function verifyPayment(tx_ref, plan) {
  try {
    const r = await axios.get('https://api.flutterwave.com/v3/transactions/verify_by_reference', {
      params: { tx_ref },
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const d = r.data && r.data.data;
    if (!d) return { paid: false, reason: 'no data' };
    if (d.tx_ref !== tx_ref) return { paid: false, reason: 'tx_ref mismatch' };
    if (d.status !== 'successful') return { paid: false, reason: `status ${d.status}` };
    if (d.currency !== 'NGN' || Number(d.amount) < plan.price) {
      return { paid: false, fraud: true, reason: `amount ${d.amount} ${d.currency} < ${plan.price} NGN` };
    }
    return { paid: true, transactionId: d.id };
  } catch (err) {
    // Flutterwave answers 400 "No transaction was found" for unpaid references
    return { paid: false, reason: err.response ? JSON.stringify(err.response.data).slice(0, 150) : err.message };
  }
}

const inFlight = new Set(); // tx_refs currently being fulfilled (prevents duplicate vouchers)

/** Verify a payment and issue exactly one voucher for it. Safe to call repeatedly. */
async function fulfill(tx_ref, source) {
  const tx = txs[tx_ref];
  if (!tx) { console.warn(`[pay] ${source}: unknown tx_ref ${tx_ref}`); return; }
  if (tx.status === 'fulfilled' || tx.status === 'rejected' || inFlight.has(tx_ref)) return;
  inFlight.add(tx_ref);

  try {
    const plan = plans[tx.planId];
    const v = await verifyPayment(tx_ref, plan);
    if (!v.paid) {
      console.log(`[pay] ${source}: ${tx_ref} not paid (${v.reason})`);
      if (v.fraud) { tx.status = 'rejected'; tx.note = v.reason; saveTxs(); }
      return;
    }

    if (tx.status !== 'voucher_failed') {
      tx.status = 'paid'; tx.transactionId = v.transactionId; tx.paidAt = new Date().toISOString(); saveTxs();
      await notify(tx, messages.paid(plan));
    }

    const code = await omada.createVoucher(tx.planId, plan.data_mb, plan.duration_h, plan.devices);
    if (code) {
      tx.status = 'fulfilled'; tx.code = code; tx.fulfilledAt = new Date().toISOString(); saveTxs();
      console.log(`[pay] ${source}: ${tx_ref} fulfilled`);
      await notify(tx, messages.code(plan, code));
    } else {
      const firstFailure = tx.status !== 'voucher_failed';
      tx.status = 'voucher_failed'; tx.attempts = (tx.attempts || 0) + 1; saveTxs();
      console.error(`[pay] ${source}: ${tx_ref} PAID but voucher creation failed (attempt ${tx.attempts}); will retry`);
      if (firstFailure) await notify(tx, messages.delayed(tx_ref));
    }
  } catch (err) {
    console.error(`[pay] ${source}: error fulfilling ${tx_ref}:`, err.message);
  } finally {
    inFlight.delete(tx_ref);
  }
}

// Every 2 minutes: re-check unpaid invoices (< 24h old) and retry paid-but-failed vouchers.
async function sweep() {
  const now = Date.now();
  for (const [ref, tx] of Object.entries(txs)) {
    const age = now - tx.createdAt;
    if (tx.status === 'pending' && age > 24 * 3600e3) { tx.status = 'expired'; saveTxs(); continue; }
    if (tx.status === 'pending' || tx.status === 'paid' || (tx.status === 'voucher_failed' && (tx.attempts || 0) < 30)) {
      await fulfill(ref, 'sweep');
    }
  }
}

async function balanceText(code) {
  const bal = await omada.getVoucherBalance(code);
  if (!bal) return `Could not find code ${code}. Check that it is typed correctly.`;
  const status = bal.status === 0 ? 'Unused' : (bal.status === 1 ? 'Active' : 'Expired');
  const usedMB = bal.used / (1024 * 1024);
  let msg = `Balance for ${code}\n\nStatus: ${status}\n`;
  if (bal.quota > 0) {
    msg += `Data: ${usedMB.toFixed(0)} MB used of ${bal.quota} MB (${Math.max(0, bal.quota - usedMB).toFixed(0)} MB left)\n`;
  } else {
    msg += `Data: unlimited (${usedMB.toFixed(0)} MB used)\n`;
  }
  return msg + `Time limit: ${bal.duration} minutes`;
}

// ---- Telegram -----------------------------------------------------------
function showMainMenu(ctx) {
  ctx.replyWithMarkdown(
    `Welcome to *OlasTech Wi-Fi*.\n\nBuy a Wi-Fi code here, or send your 8-digit code to check its balance.`,
    Markup.keyboard([['📦 View Plans'], ['📊 Check Balance', '📞 Support'], ['🚀 Start']]).resize()
  );
}
function showPlans(ctx) {
  const buttons = forSale().map(([id, p]) => [Markup.button.callback(`${p.name} - ${naira(p.price)}`, `buy_${id}`)]);
  ctx.reply('Choose a plan:', Markup.inlineKeyboard(buttons));
}

bot.command('start', showMainMenu);
bot.hears('🚀 Start', showMainMenu);
bot.hears('📦 View Plans', showPlans);
bot.command('plans', showPlans);
bot.hears('📊 Check Balance', ctx => ctx.reply('Send your 8-digit code (for example 12345678) to check its balance.'));
bot.hears('📞 Support', ctx => ctx.reply(`For help, call or WhatsApp ${SUPPORT_PHONE}.`));
bot.command('balance', async (ctx) => {
  const code = ctx.message.text.split(' ')[1];
  if (!code) return ctx.reply('Send your code with the command, for example: /balance 12345678');
  await ctx.reply(await balanceText(code));
});
bot.hears(/^[a-zA-Z0-9]{8}$/, async ctx => ctx.reply(await balanceText(ctx.message.text)));

bot.action(/buy_(.+)/, async (ctx) => {
  const planId = ctx.match[1];
  const plan = plans[planId];
  await ctx.answerCbQuery().catch(() => {});
  if (!plan || plan.hidden) return ctx.reply('That plan is no longer available. Tap View Plans to see current plans.');
  await ctx.replyWithMarkdown(`Creating your payment link for *${plan.name}* (${naira(plan.price)})…`);
  try {
    const link = await createInvoice({ channel: 'telegram', userId: ctx.chat.id, name: ctx.from.first_name, planId });
    await ctx.reply(`Pay securely with Flutterwave using the link below. Your code will be sent here as soon as payment is confirmed.\n\n${link}`);
  } catch (error) {
    console.error('[telegram] invoice error:', error.message);
    await ctx.reply('Could not create a payment link. Please try again shortly.');
  }
});

// ---- WhatsApp -----------------------------------------------------------
const seenWaMessages = new Map(); // message id -> time, Meta may deliver the same message twice

async function waShowPlans(to) {
  await wa.sendList(to, {
    body: 'Choose a Wi-Fi plan. You will get a payment link, and your code is sent here after payment.',
    button: 'View plans',
    rows: forSale().map(([id, p]) => ({ id: `buy_${id}`, title: `${p.short || p.name} - ${naira(p.price)}`.slice(0, 24), description: (p.data_mb ? "" : "Unlimited data · ") + planDetail(p) }))
  });
}

async function waHandle(msg) {
  const to = msg.from;
  const text = msg.text.toLowerCase();

  if (msg.replyId && msg.replyId.startsWith('buy_')) {
    const planId = msg.replyId.slice(4);
    const plan = plans[planId];
    if (!plan || plan.hidden) return wa.sendText(to, 'That plan is no longer available. Send "plans" to see current plans.');
    try {
      const link = await createInvoice({ channel: 'whatsapp', userId: to, name: msg.name, planId });
      return wa.sendText(to, `${plan.name} - ${naira(plan.price)}\n\nPay securely with Flutterwave here:\n${link}\n\nYour Wi-Fi code will be sent to this chat as soon as payment is confirmed.`);
    } catch (err) {
      console.error('[wa] invoice error:', err.message);
      return wa.sendText(to, 'Could not create a payment link. Please try again shortly.');
    }
  }

  const code = msg.text.replace(/\s+/g, '');
  if (/^\d{8}$/.test(code) || text.startsWith('balance')) {
    const c = text.startsWith('balance') ? msg.text.split(/\s+/)[1] : code;
    if (!c) return wa.sendText(to, 'Send your 8-digit code to check its balance, for example: 12345678');
    return wa.sendText(to, await balanceText(c));
  }

  if (/^(help|support)/.test(text)) return wa.sendText(to, `For help, call ${SUPPORT_PHONE}.`);

  // Anything else (hi, plans, menu, …): show the plans.
  await wa.sendText(to, 'Welcome to OlasTech Wi-Fi.\n\nPick a plan below to buy a code. To check a code you already have, send the 8 digits.');
  return waShowPlans(to);
}

// Meta's one-time webhook verification
app.get('/whatsapp/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && process.env.WA_VERIFY_TOKEN && req.query['hub.verify_token'] === process.env.WA_VERIFY_TOKEN) {
    return res.status(200).send(String(req.query['hub.challenge']));
  }
  res.sendStatus(403);
});

app.post('/whatsapp/webhook', (req, res) => {
  if (!wa.validSignature(req)) {
    console.warn('[wa] webhook rejected: bad or missing signature');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // acknowledge fast; Meta retries slow responses
  if (!wa.enabled()) return;
  const now = Date.now();
  for (const [id, t] of seenWaMessages) if (now - t > 3600e3) seenWaMessages.delete(id);
  for (const msg of wa.parseMessages(req.body)) {
    if (seenWaMessages.has(msg.id)) continue;
    seenWaMessages.set(msg.id, now);
    waHandle(msg).catch(err => console.error('[wa] handler error:', err.message));
  }
});

// ---- Flutterwave --------------------------------------------------------
app.get('/callback', (req, res) => {
  const { status, tx_ref } = req.query;
  console.log('Callback Received:', { status, tx_ref });
  const tx = tx_ref && txs[String(tx_ref)];
  // Send the customer back to the chat they paid from. Fulfilment verifies the payment itself.
  if (tx && tx.channel === 'link') res.redirect(`/order/${encodeURIComponent(String(tx_ref))}`);
  else res.redirect(tx && tx.channel === 'whatsapp' && WA_CHAT_URL ? WA_CHAT_URL : TELEGRAM_URL);
  if (tx_ref && (status === 'successful' || status === 'completed')) fulfill(String(tx_ref), 'callback');
});

app.post('/webhook', (req, res) => {
  const hash = process.env.FLW_SECRET_HASH;
  if (hash && req.headers['verif-hash'] !== hash) {
    console.warn('Webhook rejected: bad verif-hash');
    return res.status(401).send('Unauthorized');
  }
  const payload = req.body || {};
  const tx_ref = payload.data && payload.data.tx_ref;
  console.log('Webhook Received:', payload.event, tx_ref);
  res.status(200).send('Webhook Received');
  if (payload.event === 'charge.completed' && tx_ref) fulfill(String(tx_ref), 'webhook');
});

require('./admin')(app, { plans, forSale, createInvoice, txs, saveTxs, omada, naira, planDetail });

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Webhook server listening on port ${PORT}`);
  console.log(`WhatsApp: ${wa.enabled() ? 'enabled' : 'disabled (set WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN)'}`);
  await omada.login();
  console.log('Omada API Ready');
  sweep();
  setInterval(sweep, 2 * 60 * 1000);
});

bot.launch().then(() => {
  console.log('Bot started successfully');
}).catch((err) => {
  console.error('Bot failed to start', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
