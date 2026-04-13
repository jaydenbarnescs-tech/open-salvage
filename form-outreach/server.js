/**
 * MGC Form Outreach Server
 * Playwright-based contact form auto-submission service
 * Set env LIVE_MODE=true to actually submit forms
 */

const express = require('express');
const { chromium } = require('patchright');
const app = express();
app.use(express.json());

const PORT = 3456;
const LIVE_MODE = process.env.LIVE_MODE === 'true';

console.log(`🦞 MGC Form Outreach Server — mode: ${LIVE_MODE ? '🔴 LIVE' : '🟡 DRY RUN'}`);

// ── Crash prevention ─────────────────────────────────────────────────────────
process.on('uncaughtException', err => console.error('[UNCAUGHT]', err.message));
process.on('unhandledRejection', r => console.error('[UNHANDLED]', r?.message || r));

const wait = ms => new Promise(r => setTimeout(r, ms));

// Returns true if an element is visible to the user (not CSS-hidden)
const VISIBILITY_CHECK = `
  function isVisible(el) {
    if (!el.isConnected) return false;
    let node = el;
    while (node && node !== document.body) {
      const s = window.getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
`;

async function fillFormOnPage(page, message) {
  // Wait briefly for any dynamic content
  await wait(1500);

  const payload = { msg: message, company: 'MGC Inc.' };

  const filled = await page.evaluate(([data, visCheck]) => {
    eval(visCheck); // defines isVisible()

    // Prefer inputs inside a <form> to avoid picking up nav/footer fields
    const allInputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"])' +
      ':not([type="radio"]):not([type="file"]):not([type="search"]), textarea'
    )).filter(isVisible);

    const formInputs = allInputs.filter(el => el.closest('form'));
    const inputs = formInputs.length > 0 ? formInputs : allInputs;

    let count = 0;
    for (const input of inputs) {
      if (input.disabled || input.readOnly) continue;
      const labelEl = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
      const label = [
        input.placeholder, input.name, input.id,
        labelEl?.textContent, input.getAttribute('aria-label')
      ].filter(Boolean).join(' ').toLowerCase();

      let val = null;
      if (/first.?name|firstname/i.test(label)) val = 'Jayden';
      else if (/last.?name|lastname|surname/i.test(label)) val = 'Barnes';
      else if (/\bname\b|full.?name|your.?name/i.test(label) && input.tagName !== 'TEXTAREA') val = 'Jayden Barnes';
      else if (/email/i.test(label)) val = 'jayden.barnes@mgc-global01.com';
      else if (/company|organization|organisation|business|firm/i.test(label)) val = data.company;
      else if (/phone|tel|mobile/i.test(label)) val = '+81-80-6197-2569';
      else if (/subject|topic|title|reason|department/i.test(label)) val = 'Partnership Opportunity — MGC Inc.';
      else if (input.tagName === 'TEXTAREA') val = data.msg;

      if (val && !input.value) {
        try {
          const nativeInput = Object.getOwnPropertyDescriptor(
            input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
            'value'
          );
          if (nativeInput && nativeInput.set) nativeInput.set.call(input, val);
          else input.value = val;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          count++;
        } catch { input.value = val; count++; }
      }
    }
    return count;
  }, [payload, VISIBILITY_CHECK]);

  return filled;
}

async function fillFormInFrame(frame, message) {
  try {
    await frame.waitForLoadState('domcontentloaded', { timeout: 8000 });
    await wait(1000);
  } catch {}

  const payload = { msg: message, company: 'MGC Inc.' };

  return await frame.evaluate(([data, visCheck]) => {
    eval(visCheck); // defines isVisible()

    const allInputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"])' +
      ':not([type="radio"]):not([type="file"]):not([type="search"]), textarea'
    )).filter(isVisible);

    const formInputs = allInputs.filter(el => el.closest('form'));
    const inputs = formInputs.length > 0 ? formInputs : allInputs;

    let count = 0;
    for (const input of inputs) {
      if (input.disabled || input.readOnly) continue;
      const labelEl = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
      const label = [
        input.placeholder, input.name, input.id,
        labelEl?.textContent, input.getAttribute('aria-label')
      ].filter(Boolean).join(' ').toLowerCase();

      let val = null;
      if (/first.?name|firstname/i.test(label)) val = 'Jayden';
      else if (/last.?name|lastname|surname/i.test(label)) val = 'Barnes';
      else if (/\bname\b|full.?name|your.?name/i.test(label) && input.tagName !== 'TEXTAREA') val = 'Jayden Barnes';
      else if (/email/i.test(label)) val = 'jayden.barnes@mgc-global01.com';
      else if (/company|organization|organisation|business|firm/i.test(label)) val = data.company;
      else if (/phone|tel|mobile/i.test(label)) val = '+81-80-6197-2569';
      else if (/subject|topic|title|reason|department/i.test(label)) val = 'Partnership Opportunity — MGC Inc.';
      else if (input.tagName === 'TEXTAREA') val = data.msg;

      if (val && !input.value) {
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        count++;
      }
    }
    return count;
  }, [payload, VISIBILITY_CHECK]).catch(() => 0);
}

async function findAndSubmitForm(url, companyName, message) {
  let browser;
  const result = {
    success: false, formUrl: null, fieldsFilled: 0,
    submitted: false, hasIframe: false, error: null,
    note: null, mode: LIVE_MODE ? 'LIVE' : 'DRY_RUN'
  };

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    // ── Step 1: Load home page ──────────────────────────────────────────────
    const homeUrl = url.startsWith('http') ? url : `https://${url}`;
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // ── Step 2: Find contact page link from nav/footer ──────────────────────
    const contactLink = await page.$$eval('a', as => {
      const found = as.find(a =>
        /\bcontact\b|\binquiry\b|\benquiry\b|\bget.in.touch\b|\breach.us\b/i
          .test(a.textContent + a.getAttribute('href'))
      );
      return found ? found.href : null;
    }).catch(() => null);

    let formUrl = contactLink;

    if (!formUrl) {
      // Fallback: try /contact directly
      const origin = new URL(homeUrl).origin;
      formUrl = origin + '/contact';
    }

    // ── Step 3: Go to contact page ──────────────────────────────────────────
    if (formUrl !== page.url()) {
      try {
        await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
      } catch {
        // timeout ok, page may have partially loaded
      }
    }
    result.formUrl = page.url();
    // Wait for forms/iframes to render (JS SPAs need time)
    try {
      await page.waitForSelector('form, input[type=text], textarea, iframe[src]', { timeout: 5000 });
    } catch {}
    await wait(2000);

    // ── Step 4: Check for iframes (embedded form services) ─────────────────
    const iframeSrcs = await page.$$eval('iframe', fs =>
      fs.map(f => f.src || f.getAttribute('data-src') || '').filter(Boolean)
    ).catch(() => []);
    result.hasIframe = iframeSrcs.length > 0;

    // ── Step 5: Fill form (try page first, then iframes) ────────────────────
    let filled = await fillFormOnPage(page, message);

    // Try filling inside iframes if page had no fields
    if (filled === 0 && iframeSrcs.length > 0) {
      for (const iframeSrc of iframeSrcs.slice(0, 3)) {
        try {
          const frame = page.frame({ url: iframeSrc }) ||
            page.frames().find(f => f.url().includes(new URL(iframeSrc).hostname));
          if (frame) {
            filled = await fillFormInFrame(frame, message);
            if (filled > 0) {
              result.note = `Filled form in iframe: ${new URL(iframeSrc).hostname}`;
              break;
            }
          }
        } catch {}
      }
    }

    result.fieldsFilled = filled;
    result.success = filled > 0;

    if (LIVE_MODE && filled > 0) {
      try {
        const preSubmitUrl = page.url();

        // Find submit button on main page first, then inside iframes
        let submitBtn = await page.$('button[type="submit"], input[type="submit"]');
        let submitFrame = null;

        if (!submitBtn) {
          // Try text-based button on main page
          const btns = await page.$$('button');
          for (const btn of btns) {
            const txt = (await btn.textContent()) || '';
            if (/submit|send|contact|inquire|お問い合わせ|送信/i.test(txt)) { submitBtn = btn; break; }
          }
        }

        // If still not found and form was in an iframe, look there
        if (!submitBtn && iframeSrcs.length > 0) {
          for (const iframeSrc of iframeSrcs.slice(0, 3)) {
            try {
              const frame = page.frame({ url: iframeSrc }) ||
                page.frames().find(f => f.url().includes(new URL(iframeSrc).hostname));
              if (!frame) continue;
              const frameBtn = await frame.$('button[type="submit"], input[type="submit"]');
              if (frameBtn) { submitBtn = frameBtn; submitFrame = frame; break; }
              const frameBtns = await frame.$$('button');
              for (const btn of frameBtns) {
                const txt = (await btn.textContent()) || '';
                if (/submit|send|contact|inquire|お問い合わせ|送信/i.test(txt)) {
                  submitBtn = btn; submitFrame = frame; break;
                }
              }
              if (submitBtn) break;
            } catch {}
          }
        }

        if (submitBtn) {
          await submitBtn.click();
          result.submitted = true;
          await wait(3500);

          // Check for post-submit confirmation
          const postUrl = page.url();
          const urlChanged = postUrl !== preSubmitUrl;
          const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
          const confirmed = urlChanged ||
            /thank.?you|thanks|received|success|sent|confirm|完了|送信しました|ありがとう/i.test(bodyText);

          result.submitConfirmed = confirmed;
          result.postSubmitUrl = postUrl !== preSubmitUrl ? postUrl : null;
          result.note = confirmed
            ? 'LIVE — submitted and confirmed'
            : 'LIVE — submitted (no confirmation page detected)';
        } else {
          result.note = 'LIVE — filled but no submit button found';
        }
      } catch (e) {
        result.note = `LIVE — submit error: ${e.message.slice(0, 150)}`;
      }
    } else {
      result.note = filled > 0
        ? 'DRY RUN — fields filled, not submitted'
        : result.hasIframe
          ? 'No HTML form fields (iframe/embedded form detected)'
          : 'No fillable form fields found';
    }

  } catch (err) {
    result.error = err.message.slice(0, 200);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return result;
}

app.post('/submit-form', async (req, res) => {
  const { url, company_name, message } = req.body;
  if (!url || !message) return res.status(400).json({ error: 'url and message required' });

  console.log(`[${new Date().toISOString()}] ${LIVE_MODE ? '🔴' : '🟡'} ${company_name}`);
  let result;
  try {
    result = await findAndSubmitForm(url, company_name || 'Unknown', message);
  } catch (e) {
    result = { success: false, error: e.message, mode: LIVE_MODE ? 'LIVE' : 'DRY_RUN' };
  }
  console.log(`  → fields=${result.fieldsFilled ?? 0} submitted=${result.submitted ?? false} err=${result.error || 'none'}`);
  res.json(result);
});

// ── /update-sheet — update Buyers sheet row for a company after form submission ──
// Called by n8n WF2 webhook flow (workaround: no Google Sheets OAuth in n8n)
// Body: { company, formUrl, status }
app.post('/update-sheet', async (req, res) => {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  const { company, formUrl, status } = req.body;
  if (!company) return res.status(400).json({ error: 'company required' });

  const SHEET_ID = '12en0oLlGQ5qdPMpsms4BXDwFdPDfne_0OamG4phJ5fM';
  const today = new Date().toISOString().slice(0, 10);
  const newStatus = status || `Form Sent ${today}`;

  try {
    // Step 1: Read all company names from column B (rows 2-300)
    const { stdout } = await execFileAsync('/opt/homebrew/bin/gog', [
      'sheets', 'get', SHEET_ID, 'Buyers!B2:B300', '--plain'
    ]);

    const lines = stdout.trim().split('\n');
    const rowIndex = lines.findIndex(line =>
      line.trim().toLowerCase() === company.trim().toLowerCase()
    );

    if (rowIndex === -1) {
      return res.status(404).json({ error: `Company not found: ${company}` });
    }

    const sheetRow = rowIndex + 2; // +2: 1-indexed + skip header

    // Step 2: Update column J (Status) and optionally D (Domain/formUrl)
    await execFileAsync('/opt/homebrew/bin/gog', [
      'sheets', 'update', SHEET_ID, `Buyers!J${sheetRow}`, newStatus
    ]);

    if (formUrl) {
      await execFileAsync('/opt/homebrew/bin/gog', [
        'sheets', 'update', SHEET_ID, `Buyers!D${sheetRow}`, formUrl
      ]);
    }

    console.log(`[update-sheet] ${company} → row ${sheetRow} status="${newStatus}"${formUrl ? ` domain="${formUrl}"` : ''}`);
    res.json({ success: true, row: sheetRow, status: newStatus });

  } catch (err) {
    console.error('[update-sheet] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({
  status: 'ok', service: 'MGC Form Outreach Server',
  mode: LIVE_MODE ? 'LIVE' : 'DRY_RUN', port: PORT
}));

app.listen(PORT, () => {
  console.log(`🚀 MGC Form Outreach Server on port ${PORT} — ${LIVE_MODE ? '🔴 LIVE' : '🟡 DRY RUN'}`);
});
