# MGC Form Outreach System Architecture

**Status:** 🟡 DRY RUN mode (testing phase)  
**Created:** 2026-04-12  
**Last Updated:** 2026-04-12

## Overview

The MGC Form Outreach System (`フォーム営業自動化`) is an Express.js server that uses Playwright to automatically detect contact forms on overseas company websites and fill them with partnership inquiry messages on behalf of MGC Inc.

## System Components

### 1. **Form Outreach Server** (`server.js`)
- **Port:** 3456 (localhost)
- **Framework:** Express.js
- **Browser Automation:** Playwright (Chromium)
- **Mode:** DRY RUN (default) or LIVE (when `LIVE_MODE=true`)

**Key Endpoints:**
- `GET /health` — Server health check
- `POST /submit-form` — Submit form to a target URL
  ```json
  {
    "url": "https://company.com",
    "company_name": "Company Name",
    "message": "Partnership inquiry text..."
  }
  ```

**Response:**
```json
{
  "success": true,
  "formUrl": "https://company.com/contact",
  "fieldsFilled": 6,
  "submitted": false,
  "hasIframe": false,
  "note": "DRY RUN — form filled, not submitted",
  "mode": "DRY_RUN"
}
```

### 2. **Batch Runner** (`batch-runner.js`)
Reads CSV files of target companies and submits outreach requests to the server with automatic rate limiting.

**Usage:**
```bash
node batch-runner.js \
  --csv MGC_Target_Companies_63.csv \
  --limit 10 \
  --delay 5
```

**Features:**
- CSV parsing with quoted field support
- Configurable delay between submissions (random 2-10s default)
- Per-request timeout: 90 seconds
- Results logged to `results/batch_YYYY-MM-DD.json`
- Rate limiting to avoid overwhelming target servers

### 3. **Target Company Lists (CSV)**
- **Matsuo-san's list:** `MGC_Target_Companies_63.csv` (62 food/beverage/luxury companies)
- **Jayden's list:** `MGC_Target_Companies_100_Plus.csv` (194 electronics/apparel/specialty companies)
- **Total:** 257 overseas buyers (USA, Australia, EU)

**CSV Columns:**
- Company Name
- Country  
- Sector
- Website
- Status
- Assigned To

## Form Detection & Filling Logic

### Contact Page Discovery
1. Parse target homepage for contact-related links
2. Look for links matching: `/contact`, `/inquiry`, `/contact-us`, etc.
3. Navigate to detected contact page or fall back to homepage

### Form Field Detection
Finds and fills these common field types:
- **Name fields:** first name, last name, full name
- **Email:** jayden.barnes@mgc-global01.com
- **Company:** MGC Inc.
- **Phone:** +81-80-6197-2569
- **Subject/Title:** "Partnership Opportunity — MGC Inc."
- **Message/Inquiry:** Custom partnership message

### Iframe Handling (Beta)
- Detects embedded forms in iframes (Wufoo, Typeform, HubSpot)
- Attempts to fill fields within detected iframes
- Frames from cross-origin services may have access limitations

### Field Matching Algorithm
For each form field:
1. Analyze field label, name, ID, placeholder, aria-label
2. Match against regex patterns for field type
3. Populate with appropriate value if match found
4. Trigger `input` and `change` events for JavaScript frameworks

## DRY RUN vs LIVE Mode

### DRY RUN (Default)
- Detects and **fills** forms
- **Does NOT submit** forms  
- Useful for testing and verification
- No risk to production

**Start:**
```bash
node server.js
```

### LIVE Mode
- Detects, fills, **AND submits** forms
- Requires explicit `LIVE_MODE=true`
- Waits 3s for server response after submission
- **Use with caution**

**Start:**
```bash
LIVE_MODE=true node server.js
```

## Known Limitations

### High Failure Rate (~70-80%)
Reasons:
- **Iframe forms** (Wufoo, Typeform, HubSpot) — limited access
- **Single Page Apps** (React, Vue) — dynamic form rendering  
- **CAPTCHA/Bot Protection** — Cloudflare, reCAPTCHA
- **Non-standard forms** — custom JavaScript implementations
- **Broken/redirecting sites** — 404s, redirects
- **Connection issues** — timeout, refused connections

### Workarounds (Future)
1. **Browser fingerprinting:** Mimic human behavior more closely
2. **JavaScript execution wait:** Longer `networkidle` waits
3. **Third-party form service detection:** Special handling for Wufoo, Typeform, HubSpot APIs
4. **Headless service API:** Use headless browser APIs instead of Playwright (Puppeteer, Browserly, etc.)
5. **Pre-screened lists:** Manually verify companies have standard HTML forms before outreach

## Results & Success Metrics

### Baseline (10-company test, 2026-04-12)
- **Success rate:** 20% (2/10)
- **No form found:** 30% (3/10)
- **Server errors:** 50% (5/10)

**Successful forms detected:**
- Mutual Trading Co. (6 fields filled)
- ICREST USA (4 fields filled)

### Full Batch Status
- **Matsuo-san's 62 companies:** In progress
- **Jayden's 194 companies:** In progress
- **Target completion:** ~30-60 minutes

## Message Template

```text
Hello,

My name is Jayden Barnes, VP of Growth at MGC Inc. — we help Japanese manufacturers and suppliers expand their overseas sales using AI-powered outreach and marketing.

I'm reaching out because your company imports from Japan, and I believe we have a partnership opportunity that could create additional value for both of our businesses.

Here's the concept: If you work with Japanese suppliers who would benefit from finding more overseas buyers, we'd love to connect with them. When they sign up with MGC, we pay you a referral commission of 15% of their initial contract, plus 10% of monthly revenue for 36 months — with no extra work required on your side.

Think of it as a simple introduction: you connect us with your Japanese suppliers, we help them grow their international sales, and you earn ongoing commission from that relationship.

Would you be open to a 15-minute call to explore this further?

Best regards,
Jayden Barnes
VP of Growth — MGC Inc.
jayden.barnes@mgc-global01.com
+81-80-6197-2569
https://mgc-global01.com
```

## Next Steps

1. **Complete full batch:** Analyze results from all 257 companies
2. **Identify high-success sectors:** Which industries have higher form detection rates?
3. **Create filtered list:** Companies where forms were successfully detected
4. **Live submission test:** On filtered list only
5. **Performance optimization:**
   - Increase timeouts for slow sites
   - Add reCAPTCHA detection/handling
   - Implement headless service rotation (proxy pool)
6. **n8n integration:** Automate via workflow trigger on schedule

## Files

```
~/clawd/form-outreach/
├── server.js              # Main Express server (Playwright)
├── batch-runner.js        # CSV batch processor
├── package.json           # Dependencies
├── inspect.js             # Debugging tool (inspect URLs)
├── test-form.js           # Form field inspector
├── results/               # Results JSON logs
│   └── batch_YYYY-MM-DD.json
└── ARCHITECTURE.md        # This file
```

## References

- **Playwright Docs:** https://playwright.dev
- **Browser Automation:** Chromium (headless)
- **Form Standards:** HTML5 input types, ARIA labels, common patterns
- **Rate Limiting:** 2-10s random delay per request
- **Timeout:** 90s per request, 25s per page navigation
