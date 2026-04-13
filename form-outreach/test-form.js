const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();
  await page.goto('https://www.jfc.com/contact', { waitUntil: 'networkidle', timeout: 30000 });
  const inputs = await page.$$eval('input, textarea, select', els => els.map(e => ({
    tag: e.tagName, type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, class: e.className.slice(0,50)
  })));
  console.log('Fields found:', inputs.length);
  console.log(JSON.stringify(inputs, null, 2));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
