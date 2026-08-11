const { chromium } = require('patchright');
const wait = ms => new Promise(r => setTimeout(r, ms));

const candidates = [
  'https://kawasakirobotics.com',
  'https://rheebrothers.com',
  'https://lamtc.com',
  'https://icrestusa.com',
  'https://nextyelectronics.com',
  'https://nsk.com',
  'https://mitsui.com',
  'https://japanparts.com',
];

async function check(url) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await wait(1500);
    const contactLink = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(a => /contact|inquiry|enquiry/i.test(a.textContent + a.href));
      return a ? a.href : null;
    });
    if (!contactLink) { console.log(url, '-> no contact link'); return; }
    await page.goto(contactLink, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await wait(3000);
    const platform = await page.evaluate(() => {
      const src = document.documentElement.innerHTML;
      if (src.includes('hs-form') || src.includes('hubspot') || src.includes('hbspt')) return 'HubSpot';
      if (src.includes('jotform')) return 'JotForm';
      if (src.includes('typeform')) return 'Typeform';
      if (src.includes('wufoo')) return 'Wufoo';
      if (src.includes('gravity') || src.includes('gform')) return 'GravityForms';
      if (src.includes('wpcf7') || src.includes('contact-form-7')) return 'CF7';
      if (src.includes('forminator')) return 'Forminator';
      if (src.includes('wpforms')) return 'WPForms';
      if (src.includes('mailchimp')) return 'Mailchimp';
      return null;
    });
    if (platform) console.log(url, '->', contactLink, '|', platform, '✓');
  } catch(e) { /* skip */ }
  await browser.close();
}

Promise.all(candidates.map(check)).catch(console.error);
