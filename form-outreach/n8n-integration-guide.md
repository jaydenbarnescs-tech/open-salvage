# n8n Integration Guide — フォーム営業自動化

For: @Agent (松尾さん)  
Date: 2026-04-12

---

## Overview

We've built a **Form Outreach Server** (Express.js + Playwright) that automatically fills contact forms on overseas company websites. This guide explains how to integrate it into an n8n workflow.

## Architecture

```
┌─────────────────┐
│  Google Sheets  │  Target company CSV (URL, name, sector)
│   257 companies │
└────────┬────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ n8n Workflow (Scheduled weekly)      │
│  1. Read Google Sheets              │
│  2. For each company:               │
│     → POST to Form Server (3456)    │
│  3. Log results                     │
│  4. Notify Slack                    │
└────────┬────────────────────────────┘
         │
         ↓
┌────────────────────────────────────┐
│ Form Outreach Server (localhost:3456) │  DRY RUN mode (safe)
│  • Finds contact page              │  or LIVE mode (submit)
│  • Detects form fields             │
│  • Fills form + submits            │
│  • Returns results JSON            │
└────────────────────────────────────┘
```

## Server Endpoints

### Health Check
```
GET http://localhost:3456/health

Response:
{
  "status": "ok",
  "service": "MGC Form Outreach Server",
  "mode": "DRY_RUN" | "LIVE",
  "port": 3456
}
```

### Submit Form
```
POST http://localhost:3456/submit-form

Request body:
{
  "url": "https://company.com",
  "company_name": "Company Name",
  "message": "Partnership inquiry text..."
}

Response:
{
  "success": true/false,
  "formUrl": "https://company.com/contact",
  "fieldsFilled": 6,
  "submitted": false,
  "hasIframe": false,
  "error": null,
  "note": "DRY RUN — form filled, not submitted",
  "mode": "DRY_RUN" | "LIVE"
}
```

## n8n Workflow Structure

### Option 1: Simple Version (Testing)

**Nodes:**
1. **HTTP Trigger** — Manual or scheduled
2. **Read Spreadsheet** — Get companies from Google Sheets
3. **Loop** — For each company row
4. **HTTP Request** — POST to form server
5. **Set** — Parse response
6. **Log** — Save results to Airtable/Supabase
7. **Notify Slack** — Send summary

**Pseudocode:**
```javascript
// For each company in sheet:
POST http://localhost:3456/submit-form {
  url: row.Website,
  company_name: row.CompanyName,
  message: OUTREACH_MESSAGE
}

// Check response:
if (response.success && response.fieldsFilled > 0) {
  // Form was found and filled
  logResult(row, "success", response.fieldsFilled)
} else {
  logResult(row, "no_form", response.note)
}
```

### Option 2: Advanced Version (Production)

**Additional features:**
1. **Rate limiting** — Respect server load (add delays between requests)
2. **Error recovery** — Retry on timeout
3. **Sector filtering** — Only target high-success sectors
4. **Response tracking** — Link form submissions to actual customer responses
5. **Multi-mode toggle** — Switch between DRY_RUN and LIVE via webhook/env

**Pseudocode:**
```javascript
// Pre-filter by sector (tech/apparel have higher success)
companies = sheets.filter(c => c.Sector in HIGH_SUCCESS_SECTORS)

// Implement exponential backoff on errors
for (company of companies) {
  try {
    response = http.post(server, {
      url: company.Website,
      company_name: company.Name,
      message: MESSAGE
    }, { timeout: 90s })
    
    if (response.success) {
      logSuccess(company, response.fieldsFilled)
      supabase.insert('form_submissions', {
        company_id: company.id,
        submitted_at: now(),
        fields_filled: response.fieldsFilled
      })
    }
  } catch(err) {
    // Exponential backoff: 5s, 10s, 20s, 40s
    await sleep(5000 * Math.pow(2, retryCount))
    retry()
  }
  
  // Rate limiting: 5-20s between requests
  await sleep(random(5000, 20000))
}
```

## Setup Steps

### 1. Ensure Server is Running
```bash
cd ~/clawd/form-outreach
node server.js  # DRY RUN mode

# Or for LIVE submission:
LIVE_MODE=true node server.js
```

### 2. Create n8n Workflow
1. New workflow
2. Add HTTP Trigger (manual or scheduled)
3. Add "Read from Google Sheets" node
4. Add "Loop" node (for each row)
5. Inside loop:
   - Add "HTTP Request" node
   - Configure as POST to `http://localhost:3456/submit-form`
   - Map request body:
     ```json
     {
       "url": "{{ $json.Website }}",
       "company_name": "{{ $json.CompanyName }}",
       "message": "{{ $env.OUTREACH_MESSAGE }}"
     }
     ```
6. Add "Set" node to extract response fields
7. Add "Airtable/Supabase" node to log results
8. Add "Slack" node for notifications

### 3. Environment Variables
Set in n8n or `.env`:
```
OUTREACH_MESSAGE="Hello,\n\nMy name is Jayden Barnes..."
FORM_SERVER_URL=http://localhost:3456
LIVE_MODE=false  # Set to true for actual submissions
RATE_LIMIT_DELAY_MIN=5000
RATE_LIMIT_DELAY_MAX=20000
```

### 4. Schedule
- **Test mode:** Manual run (DRY_RUN)
- **Weekly:** Run every Monday 9 AM
- **Batch size:** Start with 20-30 companies, increase as confidence grows

## Expected Results

Based on initial testing (100 companies):

| Outcome | Rate | Action |
|---------|------|--------|
| Form found & filled | ~25-30% | Whitelisted for LIVE |
| No form detected | ~40-50% | Skip in next batch |
| Server error | ~20-30% | Retry or skip |

**Recommended workflow:**
1. Run on all 257 companies in **DRY RUN** mode weekly
2. Extract successful submissions (form found)
3. Run LIVE mode only on successful subset (~80-100 companies)
4. Track form submissions → actual customer responses

## Monitoring & Alerts

### Slack Notifications
```
📊 Form Outreach Weekly Summary
├ Total companies processed: 257
├ Forms found: 75 (29%)
├ Forms submitted (LIVE): 25 (if enabled)
├ Errors: 62 (24%)
└ Ready for review: whitelist_2026-04-12.csv

Top sectors with high success:
  • Electronics: 40%
  • Fashion: 35%
  • Jewelry: 32%
```

## Troubleshooting

### Server crashes during workflow
- **Cause:** Playwright browser crashes on difficult sites
- **Fix:** Add error handling + retry in n8n workflow
- **Workaround:** Limit batch size or increase delays

### Forms not being submitted in LIVE mode
- **Cause:** Missing or hard-to-find submit buttons
- **Fix:** Improve form detection logic in server.js
- **Status:** Already handles most common button patterns

### Spam/blocked emails
- **Cause:** Automated form submissions triggered spam filters
- **Mitigation:** Use legitimate MGC company email, add unsubscribe links
- **Alternative:** Contact company via email/LinkedIn instead

## Next Steps (For @Agent)

1. **Review** server architecture in `/Users/jayden.csai/clawd/form-outreach/ARCHITECTURE.md`
2. **Test** server health: `curl http://localhost:3456/health`
3. **Build** n8n workflow following Option 1 (simple) first
4. **Verify** results on small test batch (10-20 companies)
5. **Deploy** to production with monitoring
6. **Share** Slack notification template with team

---

Questions or issues? Claw can provide more details on:
- Form detection logic improvements
- Handling iframe forms (Wufoo, Typeform, etc.)
- Multi-language outreach messages
- A/B testing different message templates
