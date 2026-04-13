const { chromium } = require('patchright');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  await page.goto('https://jinyaramenbar.com', { waitUntil: 'networkidle', timeout: 20000 });
  await wait(1500);

  const contactLink = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find(a => /contact|inquiry|enquiry/i.test(a.textContent + a.href));
    return a ? a.href : null;
  });
  console.log('Contact link:', contactLink);
  if (!contactLink) { await browser.close(); return; }

  await page.goto(contactLink, { waitUntil: 'networkidle', timeout: 15000 });
  await wait(2000);

  // Inspect
  const info = await page.evaluate(() => {
    function isVisible(el) {
      let node = el; while (node && node !== document.body) { const s = window.getComputedStyle(node); if (s.display==='none'||s.visibility==='hidden') return false; node = node.parentElement; } const r = el.getBoundingClientRect(); return r.width>0&&r.height>0;
    }
    const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=search]), textarea')).filter(isVisible)
      .map(el => { const lbl = el.id ? document.querySelector('label[for="'+el.id+'"]') : null; return { tag: el.tagName, type: el.type, id: el.id, name: el.name, placeholder: el.placeholder, label: lbl?.textContent?.trim()?.slice(0,30) }; });
    const btns = Array.from(document.querySelectorAll('button[type=submit], input[type=submit]')).filter(isVisible)
      .map(el => ({ text: el.textContent?.trim()?.slice(0,40), value: el.value, id: el.id }));
    const forms = Array.from(document.querySelectorAll('form')).map(f => ({ id: f.id, action: f.action, method: f.method }));
    return { inputs, btns, forms };
  });
  console.log('Fields:', JSON.stringify(info.inputs, null, 1));
  console.log('Buttons:', JSON.stringify(info.btns));
  console.log('Forms:', JSON.stringify(info.forms));
  await browser.close();
})().catch(e => console.error('ERROR:', e.message));
