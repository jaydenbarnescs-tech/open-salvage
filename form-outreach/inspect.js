// Inspect a URL for form fields — pass URL as first arg
const { chromium } = require('playwright');
const url = process.argv[2] || 'https://wismettacusa.com/general-inquiry/';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('URL:', page.url());
  console.log('Title:', await page.title());

  const allInputs = await page.$$eval(
    'input, textarea, select, iframe',
    els => els.map(e => ({
      tag: e.tagName, type: e.type || null,
      name: e.name || null, id: e.id || null,
      placeholder: e.placeholder || null,
      src: e.src || null,
      class: e.className ? e.className.slice(0, 60) : null
    }))
  );

  console.log('\nAll form elements:', allInputs.length);
  console.log(JSON.stringify(allInputs, null, 2));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
