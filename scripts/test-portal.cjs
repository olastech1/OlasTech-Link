// Requires Playwright; CHROME_PATH can select an existing Chrome installation.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  if (req.url === '/connected') return res.end('Connected');
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file.endsWith('/') ? file + 'index.html' : file, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const plan = { id:'day', name:'Daily', price:500, duration_h:24, data_mb:3072, devices:1, is_popular:true };
    await page.route('**/api/plans', r => r.fulfill({json:{success:true, plans:[plan]}}));
    await page.goto(base + '/index.html?clientMac=AA-BB-CC-DD-EE-FF&ssidName=TestWiFi');
    await page.getByRole('button', {name:/Daily/}).click();
    assert.match(await page.locator('#whatsappBuyBtn').getAttribute('href'), /Daily/);
    assert.match(await page.locator('#whatsappBuyBtn').getAttribute('href'), /AA-BB-CC-DD-EE-FF/);
    assert.equal(await page.locator('#ssidDisplay').textContent(), 'TestWiFi');
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:960});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Purchase overflow at ${width}`);
    }
    await page.route('**/api/plans', r => r.fulfill({status:503,json:{}}));
    await page.reload();
    await page.locator('#retryPlans').waitFor({state:'visible'});
    await page.route('**/api/plans', r => r.fulfill({json:{success:true,plans:[plan]}}));
    await page.locator('#retryPlans').click();
    await page.getByRole('button',{name:/Daily/}).waitFor();
    await page.route('**/portal/getPortalPageSetting',r=>r.fulfill({json:{errorCode:0,result:{authType:11,hotspot:{enabledTypes:[3]},landingUrl:base+'/connected'}}}));
    let auth;
    await page.route('**/portal/auth',r=>{auth=r.request().postDataJSON();return r.fulfill({json:{errorCode:-41502}})});
    await page.goto(base+'/template-repo/index.html?clientMac=AA-BB-CC-DD-EE-FF&apMac=11-22-33-44-55-66&radioId=1&ssidName=TestWiFi');
    assert.match(await page.locator('#button-buy').getAttribute('href'), /^https:\/\/wa\.me\/2348162747882\?text=Hello/);
    assert.equal(await page.locator('#button-buy').getAttribute('target'), '_self');
    assert.equal(await page.locator('#button-buy').textContent().then(t=>t.includes('WhatsApp')), true);
    const planLinks = await page.locator('.plan').evaluateAll(as => as.map(a => [a.textContent, decodeURIComponent(a.href.split('text=')[1])]));
    assert.equal(planLinks.length, 6);
    assert.equal(planLinks.some(([t]) => /Daily/.test(t)), false);
    for (const [label, msg] of planLinks) assert.match(msg, /^Hello OlasTech, I would like to buy the .+ plan \(₦[\d,]+, /);
    assert.match(planLinks[0][1], /50 GB plan \(₦5,000, 30 days, 4 devices\)/);
    assert.equal(await page.locator('.welcome').count(), 0);
    await page.locator('#button-login').click();
    assert.match(await page.locator('#oper-hint').textContent(),/Enter your access code/);
    await page.locator('#voucherCode').fill(' 12345678 ');
    await page.locator('#voucherCode').press('Enter');
    await page.waitForFunction(()=>document.getElementById('oper-hint').textContent.includes('isn’t correct'));
    assert.equal(auth.voucherCode,'12345678');
    assert.equal(auth.authType,3);
    assert.equal(auth.radioId,1);
    assert.equal(auth.clientMac,'AA-BB-CC-DD-EE-FF');
    assert.equal(await page.locator('#button-login').isDisabled(),false);
    await page.locator('#terms-link').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#terms-modal').isVisible(),false);
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:960});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Login overflow at ${width}`);
      if(width===1440||width===390)await page.screenshot({path:`/tmp/olastech-portal-${width}.png`,fullPage:true});
    }
    // Captive login windows must navigate directly instead of opening a popup.
    let waVisit;
    await page.route('https://wa.me/**', route => { waVisit = route.request().url(); return route.fulfill({contentType:'text/html',body:'WhatsApp'}); });
    const pageCount = page.context().pages().length;
    await page.locator('.plan').nth(2).click();
    await page.waitForURL(/wa\.me/);
    assert.match(decodeURIComponent(waVisit), /^https:\/\/wa\.me\/2348162747882\?text=Hello OlasTech, I would like to buy the 110 GB plan \(₦12,000/);
    assert.equal(page.context().pages().length, pageCount);
    await page.goBack();
    await page.locator('#voucherCode').fill('12345678');
    await page.route('**/portal/auth',r=>r.abort());
    await page.locator('#button-login').click();
    await page.waitForFunction(()=>document.getElementById('oper-hint').textContent.includes('Couldn’t reach'));
    assert.equal(await page.locator('#button-login').isDisabled(),false);
    await page.route('**/portal/auth',r=>r.fulfill({json:{errorCode:0}}));
    await page.locator('#button-login').click();
    await page.waitForURL(base+'/connected');
    assert.deepEqual(errors,[]);
    console.log('Passed: plan selection, API retry, keyboard voucher login, auth payload, invalid voucher, network retry, success redirect, WhatsApp plan links, modal, 320/390/1440px layouts.');
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
