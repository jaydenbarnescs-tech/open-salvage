const { chromium } = require('patchright');
const wait = ms => new Promise(r => setTimeout(r, ms));

// Sites most likely to use JotForm/Typeform (B2B, tools, importers)
const candidates = [
  'https://kawasakirobotics.com',
  'https://kokenusa.com',
  'https://osakatools.com',
  'https://hidatool.com',
  'https://kakuritools.com',
  'https://airdogusa.com',
  'https://lamtc.com',
  'https://icrestusa.com',
  'https://us.air-robo.com',
  'https://yumbo-jp.com',
  'https://condehouse.com',
  'https://jlifeinternational.com',
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
    if (!contactLink) return;
    await page.goto(contactLink, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await wait(3000);
    const result = await page.evaluate(() => {
      const src = document.documentElement.innerHTML;
      const platform = 
        (src.includes('jotform.com') || src.includes('jotform')) ? 'JotForm' :
        (src.includes('typeform.com')) ? 'Typeform' :
        (src.includes('hs-form') || src.includes('hbspt')) ? 'HubSpot' :
        (src.includes('gravity') || src.includes('gform_')) ? 'GravityForms' :
        (src.includes('wpforms')) ? 'WPForms' :
        (src.includes('wpcf7') || src.includes('cf7')) ? 'CF7' :
        (src.includes('forminator')) ? 'Forminator' : null;
      const captcha = !!document.querySelector('[data-sitekey],[class*=captcha],[class*=recaptcha],[class*=hcaptcha],[class*=turnstile]');
      return { platform, captcha };
    });
    if (result.platform) console.log('✓', url, '->', contactLink, '|', result.platform, result.captcha ? '(captcha)' : '(no captcha)');
  } catch(e) {}
  await browser.close();
}

Promise.all(candidates.map(check)).catch(console.error);
