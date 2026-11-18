// Admin page for WhatsApp sales: payment links (code issued automatically) and instant codes.
const crypto = require('crypto');

const failures = new Map(); // ip -> { count, until }

function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1);
  return /^\d{10,15}$/.test(d) ? d : null;
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function requireAdmin(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 10) return res.status(503).send('Admin is disabled: set ADMIN_PASSWORD (10+ characters) in .env');
  const ip = req.get('x-real-ip') || req.ip;
  const f = failures.get(ip);
  if (f && f.until > Date.now()) return res.status(429).send('Too many attempts. Try again in 15 minutes.');

  const [scheme, value] = (req.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && value) {
    const [user, ...rest] = Buffer.from(value, 'base64').toString().split(':');
    if (user === 'admin' && safeEqual(rest.join(':'), password)) { failures.delete(ip); return next(); }
    const expiredLock = f && f.until && f.until <= Date.now(); // lock ran out: start counting again
    const n = (f && !expiredLock ? f.count : 0) + 1;
    failures.set(ip, { count: n, until: n >= 8 ? Date.now() + 15 * 60e3 : 0 });
  }
  res.set('WWW-Authenticate', 'Basic realm="OlasTech admin"').status(401).send('Login required');
}

module.exports = function mountAdmin(app, { plans, forSale, createInvoice, txs, saveTxs, omada, naira, planDetail }) {
  const planLine = p => `${p.name} (${naira(p.price)}, ${planDetail(p).replace(' · ', ', ')})`;

  app.get('/admin', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store').type('html').send(ADMIN_HTML(forSale().map(([id, p]) => ({ id, label: planLine(p) }))));
  });

  app.post('/admin/api/paylink', requireAdmin, async (req, res) => {
    const { planId, phone } = req.body || {};
    const to = phone ? normalizePhone(phone) : null;
    if (phone && !to) return res.status(400).json({ error: 'Phone number not recognised' });
    const plan = plans[planId];
    if (!plan || plan.hidden) return res.status(400).json({ error: 'Choose a plan' });
    try {
      const { link, tx_ref } = await createInvoice({ channel: 'link', userId: to || 'walkin', name: 'WhatsApp customer', planId, returnRef: true });
      txs[tx_ref].phone = to; saveTxs();
      const message = `Hello, thank you for choosing OlasTech Wi-Fi.\n\nPlan: ${planLine(plan)}\nPay here: ${link}\n\nYour Wi-Fi code appears on screen as soon as payment is complete.`;
      res.json({ link, tx_ref, message, whatsapp: to ? `https://wa.me/${to}?text=${encodeURIComponent(message)}` : null });
    } catch (err) {
      console.error('[admin] paylink error:', err.message);
      res.status(502).json({ error: 'Could not create the payment link. Try again.' });
    }
  });

  app.post('/admin/api/voucher', requireAdmin, async (req, res) => {
    const { planId, phone, note } = req.body || {};
    const to = phone ? normalizePhone(phone) : null;
    if (phone && !to) return res.status(400).json({ error: 'Phone number not recognised' });
    const plan = plans[planId];
    if (!plan || plan.hidden) return res.status(400).json({ error: 'Choose a plan' });
    const code = await omada.createVoucher(planId, plan.data_mb, plan.duration_h, plan.devices);
    if (!code) return res.status(502).json({ error: 'The controller did not create a code. Try again.' });
    const ref = `OlasTech-M-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    txs[ref] = { channel: 'manual', phone: to, planId, amount: plan.price, status: 'fulfilled', code, note: String(note || '').slice(0, 100), createdAt: Date.now(), fulfilledAt: new Date().toISOString() };
    saveTxs();
    const message = `Hello, thank you for your payment.\n\nYour OlasTech Wi-Fi code: ${code}\nPlan: ${planLine(plan)}\n\nConnect to OlasTech Wi-Fi and enter this code on the login page.`;
    res.json({ code, message, whatsapp: to ? `https://wa.me/${to}?text=${encodeURIComponent(message)}` : null });
  });

  app.get('/admin/api/orders', requireAdmin, (req, res) => {
    const rows = Object.entries(txs)
      .sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 40)
      .map(([ref, t]) => ({ ref, channel: t.channel || 'telegram', plan: plans[t.planId] ? plans[t.planId].name : t.planId, amount: t.amount, status: t.status, code: t.code || null, phone: t.phone || t.waId || null, createdAt: t.createdAt }));
    res.set('Cache-Control', 'no-store').json(rows);
  });

  // Customer-facing page after paying a link: waits for the code and shows it.
  app.get('/order/:ref', (req, res) => {
    const tx = txs[req.params.ref];
    if (!tx || tx.channel !== 'link') return res.status(404).type('html').send(ORDER_HTML(null));
    res.set('Cache-Control', 'no-store').type('html').send(ORDER_HTML(req.params.ref));
  });
  app.get('/order/:ref/status', (req, res) => {
    const tx = txs[req.params.ref];
    if (!tx || tx.channel !== 'link') return res.status(404).json({ status: 'unknown' });
    const p = plans[tx.planId];
    res.set('Cache-Control', 'no-store').json({ status: tx.status, code: tx.status === 'fulfilled' ? tx.code : null, plan: p ? planLine(p) : '' });
  });
};

const BASE_CSS = `:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#14202e;background:#f3f4f6}*{box-sizing:border-box}body{margin:0}main{width:min(100% - 32px,760px);margin:0 auto;padding:24px 0}h1{font-size:22px;margin:0 0 16px}h2{font-size:16px;margin:0 0 12px}.card{background:#fff;border:1px solid #dde2e8;border-radius:12px;padding:20px;margin-bottom:16px}label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}select,input{width:100%;font:inherit;font-size:16px;padding:11px 12px;border:1px solid #c5cdd7;border-radius:8px;margin-bottom:14px;background:#fff}button,.btn{display:inline-flex;align-items:center;justify-content:center;font:inherit;font-weight:600;font-size:15px;padding:12px 16px;border-radius:8px;border:0;cursor:pointer;text-decoration:none}.primary{background:#163a63;color:#fff}.wa{background:#1a8a4a;color:#fff}.ghost{background:#eef1f4;color:#14202e}.row{display:flex;gap:8px;flex-wrap:wrap}.row>*{flex:1 1 200px}.muted{color:#5c6876;font-size:13px}.result{margin-top:14px;padding:14px;border-radius:8px;background:#f6f8fa;border:1px solid #dde2e8}.result:empty{display:none}.code{font-family:ui-monospace,Menlo,monospace;font-size:28px;letter-spacing:.12em;font-weight:700}.error{color:#9b2c1f}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:8px 6px;border-top:1px solid #e6e9ee;vertical-align:top}th{color:#5c6876;font-weight:600;border-top:0}.mono{font-family:ui-monospace,Menlo,monospace}.wrap{overflow-x:auto}button:disabled{opacity:.6;cursor:wait}`;

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function ADMIN_HTML(planOptions) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>OlasTech admin</title><style>${BASE_CSS}</style></head><body><main>
<h1>OlasTech Wi-Fi codes</h1>
<section class="card">
  <label for="plan">Plan</label>
  <select id="plan">${planOptions.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select>
  <label for="phone">Customer WhatsApp number</label>
  <input id="phone" inputmode="tel" placeholder="0803 123 4567" autocomplete="off">
  <div class="row">
    <button class="primary" id="paylink" type="button">Send payment link</button>
    <button class="ghost" id="voucher" type="button">Generate code now (already paid)</button>
  </div>
  <p class="muted">Payment link: the customer pays with Flutterwave and their code appears on screen automatically. Generate code now: use only after you have received the money.</p>
  <div class="result" id="result" aria-live="polite"></div>
</section>
<section class="card">
  <div class="row" style="align-items:center;margin-bottom:8px"><h2 style="margin:0">Recent orders</h2><button class="ghost" id="refresh" type="button" style="flex:0 0 auto">Refresh</button></div>
  <div class="wrap"><table><thead><tr><th>Time</th><th>Plan</th><th>Customer</th><th>Status</th><th>Code</th></tr></thead><tbody id="orders"></tbody></table></div>
</section>
</main><script>
const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(path,btn){const out=$('result');btn.disabled=true;out.innerHTML='Working…';
 try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:$('plan').value,phone:$('phone').value})});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Failed');
  let h=d.code?'<div class="muted">Code</div><div class="code">'+esc(d.code)+'</div>':'<div class="muted">Payment link</div><p><a href="'+esc(d.link)+'" target="_blank" rel="noopener">'+esc(d.link)+'</a></p>';
  h+='<div class="row" style="margin-top:12px">'+(d.whatsapp?'<a class="btn wa" href="'+esc(d.whatsapp)+'" target="_blank" rel="noopener">Send on WhatsApp</a>':'')+'<button class="ghost" type="button" id="copy">Copy message</button></div>';
  out.innerHTML=h;$('copy').onclick=()=>navigator.clipboard.writeText(d.message).then(()=>{$('copy').textContent='Copied'});loadOrders();
 }catch(e){out.innerHTML='<span class="error">'+esc(e.message)+'</span>'}finally{btn.disabled=false}}
$('paylink').onclick=e=>call('/admin/api/paylink',e.currentTarget);
$('voucher').onclick=e=>{if(confirm('Create a code now? Only do this after the customer has paid.'))call('/admin/api/voucher',e.currentTarget)};
async function loadOrders(){try{const rows=await (await fetch('/admin/api/orders')).json();
 $('orders').innerHTML=rows.map(o=>'<tr><td>'+new Date(o.createdAt).toLocaleString()+'</td><td>'+esc(o.plan)+'</td><td>'+esc(o.phone||o.channel)+'</td><td>'+esc(o.status)+'</td><td class="mono">'+esc(o.code||'')+'</td></tr>').join('')||'<tr><td colspan="5" class="muted">No orders yet</td></tr>';}catch(e){}}
$('refresh').onclick=loadOrders;loadOrders();
</script></body></html>`;
}

function ORDER_HTML(ref) {
  const body = ref
    ? `<h1>OlasTech Wi-Fi</h1><div class="card" id="box"><p>Confirming your payment…</p><p class="muted">This usually takes a few seconds. Keep this page open.</p></div>
<script>const ref=${JSON.stringify(ref)};let tries=0;
async function poll(){tries++;try{const d=await (await fetch('/order/'+encodeURIComponent(ref)+'/status',{cache:'no-store'})).json();
 if(d.status==='fulfilled'&&d.code){document.getElementById('box').innerHTML='<p class="muted">Your Wi-Fi code</p><div class="code">'+d.code.replace(/[^\\w]/g,'')+'</div><p>'+d.plan.replace(/[<>&]/g,'')+'</p><p>Connect to OlasTech Wi-Fi and enter this code on the login page. Save or screenshot it now.</p>';return}
 if(d.status==='rejected'){document.getElementById('box').innerHTML='<p class="error">We could not confirm this payment. Please contact us on WhatsApp: 0816 274 7882.</p>';return}
 if(d.status==='voucher_failed'){document.getElementById('box').innerHTML='<p>Payment received. Your code is taking longer than usual; this page will update automatically. If it does not, contact us on WhatsApp: 0816 274 7882.</p>'}
}catch(e){} setTimeout(poll,tries<20?3000:10000)}
poll();</script>`
    : `<h1>OlasTech Wi-Fi</h1><div class="card"><p>This order was not found. If you have paid, contact us on WhatsApp: 0816 274 7882.</p></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>OlasTech Wi-Fi order</title><style>${BASE_CSS}</style></head><body><main>${body}</main></body></html>`;
}
