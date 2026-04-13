const { chromium } = require('patchright');
const wait = ms => new Promise(r => setTimeout(r, ms));

const TARGET = process.argv[2] || 'https://nishohi.com';
const MESSAGE = 'Hi, we are MGC Inc., a Japan-based trading company. We are interested in exploring a partnership opportunity with your company. Please feel free to reply to this message. Thank you.';

async function run() {
  console.log('Target:', TARGET);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Step 1: find contact page
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const contactLink = await page.$$eval('a', as => {
    const f = as.find(a => /\bcontact\b|\binquiry\b|\benquiry\b/i.test(a.textContent + a.getAttribute('href')));
    return f ? f.href : null;
  }).catch(() => null);

  const formUrl = contactLink || (new URL(TARGET).origin + '/contact');
  console.log('Contact URL:', formUrl);

  if (formUrl !== page.url()) {
    await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 18000 }).catch(() => {});
  }
  await wait(2500);
  console.log('Landed on:', page.url());

  // Step 2: inspect visible fields
  const fields = await page.evaluate(() => {
    function isVisible(el) {
      if (!el.isConnected) return false;
      let node = el;
      while (node && node !== document.body) {
        const s = window.getComputedStyle(node);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
        node = node.parentElement;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    return Array.from(document.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=search]), textarea'
    )).filter(isVisible).map(el => ({
      tag: el.tagName, type: el.type||null, id: el.id||null,
      name: el.name||null, placeholder: el.placeholder||null,
      inForm: !!el.closest('form'), formId: el.closest('form')?.id||null
    }));
  });
  console.log('\nVisible fields found:', fields.length);
  fields.forEach((f,i) => console.log(` [${i+1}]`, JSON.stringify(f)));

  // Step 3: check for CAPTCHA
  const hasCaptcha = await page.evaluate(() => {
    return !!(document.querySelector('[class*="captcha"],[id*="captcha"],[class*="recaptcha"],[id*="recaptcha"],[class*="hcaptcha"],[data-sitekey]') ||
      document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"]'));
  });
  console.log('\nCAPTCHA detected:', hasCaptcha);

  // Step 4: fill fields
  const filled = await page.evaluate(([msg]) => {
    function isVisible(el) {
      if (!el.isConnected) return false;
      let node = el;
      while (node && node !== document.body) {
        const s = window.getComputedStyle(node);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
        node = node.parentElement;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const inputs = Array.from(document.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=search]), textarea'
    )).filter(isVisible);
    const formInputs = inputs.filter(el => el.closest('form'));
    const targets = formInputs.length > 0 ? formInputs : inputs;
    const filled = [];
    for (const input of targets) {
      if (input.disabled || input.readOnly) continue;
      const labelEl = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
      const label = [input.placeholder, input.name, input.id, labelEl?.textContent, input.getAttribute('aria-label')]
        .filter(Boolean).join(' ').toLowerCase();
      let val = null;
      if (/first.?name|firstname/i.test(label)) val = 'Jayden';
      else if (/last.?name|lastname|surname/i.test(label)) val = 'Barnes';
      else if (/\bname\b|full.?name|your.?name/i.test(label) && input.tagName !== 'TEXTAREA') val = 'Jayden Barnes';
      else if (/email/i.test(label)) val = 'jayden.barnes@mgc-global01.com';
      else if (/company|organization|organisation|business|firm/i.test(label)) val = 'MGC Inc.';
      else if (/phone|tel|mobile/i.test(label)) val = '+81-80-6197-2569';
      else if (/subject|topic|title|reason|department/i.test(label)) val = 'Partnership Opportunity — MGC Inc.';
      else if (input.tagName === 'TEXTAREA') val = msg;
      if (val && !input.value) {
        try {
          const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const native = Object.getOwnPropertyDescriptor(proto, 'value');
          if (native?.set) native.set.call(input, val); else input.value = val;
          input.dispatchEvent(new Event('input', {bubbles:true}));
          input.dispatchEvent(new Event('change', {bubbles:true}));
          filled.push({field: label.slice(0,40), value: val.slice(0,50)});
        } catch { input.value = val; filled.push({field: label.slice(0,40), value: val.slice(0,50)}); }
      }
    }
    return filled;
  }, [MESSAGE]);

  console.log('\nFilled', filled.length, 'fields:');
  filled.forEach(f => console.log(` "${f.field}" → "${f.value}"`));

  // Step 5: find submit button
  let submitBtn = await page.$('button[type="submit"], input[type="submit"]');
  if (!submitBtn) {
    const btns = await page.$$('button');
    for (const btn of btns) {
      const txt = (await btn.textContent()) || '';
      if (/submit|send|contact|inquire|お問い合わせ|送信/i.test(txt)) { submitBtn = btn; break; }
    }
  }
  const btnText = submitBtn ? await submitBtn.textContent().catch(() => 'found') : null;
  console.log('\nSubmit button:', submitBtn ? `"${btnText?.trim()}"` : 'NOT FOUND');

  if (submitBtn && filled.length > 0) {
    const preUrl = page.url();
    console.log('\nClicking submit...');
    await submitBtn.click();
    await wait(4000);
    const postUrl = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const urlChanged = postUrl !== preUrl;
    const confirmed = urlChanged || /thank.?you|thanks|received|success|sent|confirm|完了|送信しました|ありがとう/i.test(bodyText);
    console.log('URL changed:', urlChanged, '|', postUrl);
    console.log('Confirmed:', confirmed);
    console.log('Page text (first 200 chars):', bodyText.trim().slice(0, 200));
  }

  await browser.close();
}

run().catch(console.error);
