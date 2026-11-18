require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const omada = require('./omada');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(token);

const plans = {
  '300gb': { name: '300GB', price: 35000, duration_h: 720, data_mb: 307200, devices: 10 },
  '250gb': { name: '250GB', price: 20000, duration_h: 720, data_mb: 256000, devices: 5 },
  '150gb': { name: '150GB', price: 15000, duration_h: 720, data_mb: 153600, devices: 4 },
  '110gb': { name: '110GB', price: 12000, duration_h: 720, data_mb: 112640, devices: 4 },
  '50gb': { name: '50GB', price: 5000, duration_h: 720, data_mb: 51200, devices: 4 },
  'weekend': { name: 'Weekend Unlimited', price: 10000, duration_h: 48, data_mb: 0, devices: 5 },
  'daily': { name: 'Daily Unlimited', price: 3000, duration_h: 24, data_mb: 0, devices: 3 },
};

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

const inFlight = new Set(); // tx_refs currently being fulfilled (prevents duplicate vouchers)

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
      await bot.telegram.sendMessage(tx.chatId, `✅ *Payment Confirmed!*\n\nGenerating your ${plan.name} access code... Please wait.`, { parse_mode: 'Markdown' }).catch(() => {});
    }

    const code = await omada.createVoucher(tx.planId, plan.data_mb, plan.duration_h, plan.devices);
    if (code) {
      tx.status = 'fulfilled'; tx.code = code; tx.fulfilledAt = new Date().toISOString(); saveTxs();
      console.log(`[pay] ${source}: ${tx_ref} fulfilled`);
      await bot.telegram.sendMessage(tx.chatId, `🎉 *Your Wi-Fi Access Code is Ready!*\n\nCode: \`${code}\`\nPlan: ${plan.name}\nDevices Allowed: ${plan.devices}\n\nTo connect, connect to OlasTech Wi-Fi and enter this code. Enjoy!`, { parse_mode: 'Markdown' });
    } else {
      const firstFailure = tx.status !== 'voucher_failed';
      tx.status = 'voucher_failed'; tx.attempts = (tx.attempts || 0) + 1; saveTxs();
      console.error(`[pay] ${source}: ${tx_ref} PAID but voucher creation failed (attempt ${tx.attempts}); will retry`);
      if (firstFailure) {
        await bot.telegram.sendMessage(tx.chatId, `⚠️ Your payment was received, but we hit a problem generating your code. We are retrying automatically and will send it here shortly. Reference: ${tx_ref}`).catch(() => {});
      }
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

function showMainMenu(ctx) {
  ctx.replyWithMarkdown(
    `Welcome to *OlasTech Wi-Fi*! 🚀\n\nI am your automated assistant. I can help you buy Wi-Fi access codes instantly.`,
    Markup.keyboard([
      ['📦 View Plans'],
      ['📊 Check Balance', '📞 Support'],
      ['🚀 Start']
    ]).resize()
  );
}

bot.command('start', showMainMenu);
bot.hears('🚀 Start', showMainMenu);

bot.hears('📦 View Plans', (ctx) => {
  const buttons = Object.keys(plans).map(key => {
    return [Markup.button.callback(`${plans[key].name} - ₦${plans[key].price.toLocaleString()}`, `buy_${key}`)];
  });
  ctx.reply('Please choose a data plan:', Markup.inlineKeyboard(buttons));
});

bot.hears('📊 Check Balance', (ctx) => {
  ctx.reply('To check your balance, simply send your 8-digit access code (e.g. 12345678) in the chat.');
});

bot.hears('📞 Support', (ctx) => {
  ctx.reply('For support, please contact our support team or admin.');
});

bot.command('plans', (ctx) => {
  const buttons = Object.keys(plans).map(key => {
    return [Markup.button.callback(`${plans[key].name} - ₦${plans[key].price.toLocaleString()}`, `buy_${key}`)];
  });

  ctx.reply('Please choose a data plan:', Markup.inlineKeyboard(buttons));
});

async function checkBalance(ctx, code) {
  await ctx.reply(`Checking balance for code ${code}...`);
  const bal = await omada.getVoucherBalance(code);
  
  if (!bal) {
      return ctx.reply(`❌ Could not find voucher ${code}. Make sure it is typed correctly.`);
  }

  let statusText = bal.status === 0 ? "Unused" : (bal.status === 1 ? "Active" : "Expired");
  
  let msg = `📊 *Balance for ${code}*\n\n`;
  msg += `Status: ${statusText}\n`;
  
  if (bal.quota > 0) {
      const usedMB = (bal.used / (1024 * 1024)).toFixed(2);
      msg += `Data Quota: ${bal.quota} MB\n`;
      msg += `Data Used: ${usedMB} MB\n`;
      msg += `Data Remaining: ${(bal.quota - usedMB).toFixed(2)} MB\n`;
  } else {
      msg += `Data Quota: Unlimited\n`;
      msg += `Data Used: ${(bal.used / (1024 * 1024)).toFixed(2)} MB\n`;
  }
  
  msg += `Time Limit: ${bal.duration} minutes`;

  ctx.replyWithMarkdown(msg);
}

bot.command('balance', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) {
      return ctx.reply('Please provide your access code. Example: /balance 12345678');
  }
  const code = parts[1];
  await checkBalance(ctx, code);
});

bot.hears(/^[a-zA-Z0-9]{8}$/, async (ctx) => {
  const code = ctx.message.text;
  await checkBalance(ctx, code);
});

bot.action(/buy_(.+)/, async (ctx) => {
  const planId = ctx.match[1];
  const plan = plans[planId];
  if (!plan) return;

  const chatId = ctx.chat.id;
  await ctx.replyWithMarkdown(`Generating your invoice for *${plan.name}* (₦${plan.price.toLocaleString()})...`);

  const tx_ref = `OlasTech-${Date.now()}-${chatId}`;
  
  try {
    const response = await axios.post('https://api.flutterwave.com/v3/payments', {
      tx_ref: tx_ref,
      amount: plan.price,
      currency: 'NGN',
      redirect_url: `${process.env.BASE_URL}/callback`,
      customer: {
        email: `${chatId}@olastech.com`,
        name: ctx.from.first_name || 'Customer'
      },
      customizations: {
        title: 'OlasTech Wi-Fi',
        description: `Payment for ${plan.name} Wi-Fi Plan`
      }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`
      }
    });

    if (response.data.status === 'success') {
      const link = response.data.data.link;
      txs[tx_ref] = { chatId, planId, amount: plan.price, status: 'pending', createdAt: Date.now() };
      saveTxs();
      await ctx.reply(`Click the link below to pay securely via Flutterwave. Your voucher will be sent here automatically as soon as payment is confirmed!\n\n${link}`);
    } else {
      await ctx.reply(`Failed to generate payment link. Please try again later.`);
    }
  } catch (error) {
    console.error(error);
    await ctx.reply(`An error occurred while generating your invoice.`);
  }
  await ctx.answerCbQuery();
});

app.get('/callback', async (req, res) => {
  const { status, tx_ref } = req.query;
  console.log('Callback Received:', { status, tx_ref });
  // Redirect immediately; fulfilment verifies the payment itself, so query params are not trusted.
  res.redirect('https://t.me/Olastech_bot');
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Webhook server listening on port ${PORT}`);
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
