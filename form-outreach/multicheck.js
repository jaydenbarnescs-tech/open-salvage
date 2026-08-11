const { chromium } = require('patchright');
const wait = ms => new Promise(r => setTimeout(r, ms));

const sites = [
  'https://tazakifoods.com',
  'https://jfc.eu',
  'https://cbcco.com',
  'https://globalcutleryusa.com',
  'https://wakousa.com',
  'https://directfromjapan.com.au',
];

async function check(url) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await wait(1500);
    const contactLink = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(a => /contact|inquiry|enquiry/i.test(a.textContent + a.href));
      return a ? a.href : null;
    });
    if (!contactLink) { console.log(url, '-> no contact link'); return; }
    await page.goto(contactLink, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await wait(2500);
    const info = await page.evaluate(() => {
      function isVisible(el) { let n=el; while(n&&n!==document.body){const s=window.getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return false;n=n.parentElement;}const r=el.getBoundingClientRect();return r.width>0&&r.height>0; }
      const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=search]), textarea')).filter(isVisible);
      const captcha = !!document.querySelector('[data-sitekey], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], [class*=captcha]');
      const formPlatform = document.querySelector('[class*=forminator]') ? 'forminator' :
        document.querySelector('[class*=wpcf7]') ? 'cf7' :
        document.querySelector('[class*=hubspot],[class*=hs-form]') ? 'hubspot' :
        document.querySelector('[class*=gravity]') ? 'gravity' :
        document.querySelector('[class*=ninja]') ? 'ninja' :
        document.querySelector('form[action*=formspree]') ? 'formspree' : 'unknown';
      return { fields: inputs.length, captcha, formPlatform };
    });
    console.log(url, '->', contactLink, '| fields:', info.fields, '| captcha:', info.captcha, '| platform:', info.formPlatform);
  } catch(e) { console.log(url, '-> error:', e.message.slice(0,60)); }
  await browser.close();
}

Promise.all(sites.map(check)).catch(console.error);
