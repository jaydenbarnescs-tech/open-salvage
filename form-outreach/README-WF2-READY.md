# 🚀 WF2 Is Ready — Quick Start (3 Steps)

**Status:** All setup complete. Form server running. Ready for activation.

---

## The 3-Step Activation Process

### ✅ Step 1: Create Google Sheets Credential (10 min)

1. Open: `http://mgc-pass-proxy.duckdns.org:5678`
2. Left sidebar → **Credentials**
3. **New** → **Google Sheets**
4. Click **"Authenticate with Google"**
5. Sign in, grant permissions
6. Save as: `Google Sheets OAuth - Jayden`

**Alternative (if you have a service account JSON):**
- Upload JSON file instead of using OAuth
- More reliable for automated workflows

### ✅ Step 2: Activate WF2 Workflow (1 min)

1. In n8n, search for: `EJ55iETQ1uYKKHMu` (or find "WF2")
2. Open the workflow
3. Click the **Activate** button (top right)
4. Wait for green "Active" status

### ✅ Step 3: Test It (5 min)

**Option A: Quick Manual Test**
1. Click **Execute** button in WF2
2. Watch the logs
3. Should see form server called and results logged

**Option B: Via Command Line**
```bash
cd ~/clawd/form-outreach
node wf2-test-simple.js
```

Shows:
- Form server health
- Companies tested
- Success rate
- Results saved

---

## What This Does

The WF2 workflow:

1. **Reads** a Google Sheet of companies (URL, name, etc.)
2. **Calls** the form server for each company
3. **Detects** contact forms on their websites
4. **Fills** the forms with partnership inquiry message
5. **Updates** the Status column in Google Sheets
6. **Reports** results (found/not found/error)
7. **DRY_RUN** mode = fills but doesn't submit (safe)

---

## Expected Results

**Form Detection Rate:** 25-30% of companies
- Some sites don't have contact forms
- Some use iframe forms (harder to detect)
- Some have bot protection

**What you'll see in Sheet:**
```
Company Name | Website | Status
Test Company | example.com | 送信済み ✅
No Form Co | noform.com | 検出なし ⚠️
Blocked Site | blocked.com | 失敗 ❌
```

---

## Production Checklist (After Testing)

When you want to go from testing to production:

- [ ] Test run completed successfully
- [ ] Google Sheet status updates work
- [ ] Slack notifications configured (optional)
- [ ] Create company whitelist (forms that were found)
- [ ] **Optional:** Set `LIVE_MODE=true` to actually submit forms
- [ ] Schedule weekly runs: Monday 9 AM JST
- [ ] Monitor results for 1-2 weeks

---

## Architecture Overview

```
Google Sheets (Companies)
    ↓
n8n WF2 Workflow
    ↓ (for each row)
Form Server (localhost:3456)
    ↓ (uses Playwright)
Target Website
    ↓ (finds contact form)
Auto-fill form with message
    ↓ (DRY_RUN = no submit)
Return results to WF2
    ↓
Update Sheet status column
```

---

## Files Created

| File | What It Does |
|------|--------------|
| `WF2-SETUP-GUIDE.md` | Detailed instructions for each step |
| `WF2-COMPLETION-REPORT.md` | Full technical report |
| `TEST-DATA.csv` | Sample data for testing |
| `wf2-test-simple.js` | Test script |

---

## Help & Troubleshooting

**Form server down?**
```bash
curl http://localhost:3456/health
# If error, restart:
cd ~/clawd/form-outreach && node server.js
```

**Google Sheets credential issues?**
- Try OAuth first (easier to debug)
- If you have a service account JSON, use that instead
- Check the account has Sheet edit permissions

**Workflow won't activate?**
- Check for red X icons on nodes
- Verify Google Sheets credential is selected
- Make sure all required node settings are filled

**Questions?**
- See `WF2-SETUP-GUIDE.md` for step-by-step instructions
- Check `WF2-COMPLETION-REPORT.md` for detailed technical info
- See `ARCHITECTURE.md` for how the form detection works

---

## Current Status

| Component | Status | Details |
|-----------|--------|---------|
| Form Server | ✅ Running | Port 3456, DRY_RUN mode |
| Google Sheets Credential | ⏳ Needs setup | Step 1 above |
| WF2 Workflow | ⏳ Needs activation | Step 2 above |
| Test Data | ✅ Ready | TEST-DATA.csv |
| Integration Test | ✅ Ready | Run wf2-test-simple.js |

---

## Next Actions (In Order)

1. **Create Google Sheets credential** (10 min)
   - n8n → Credentials → New → Google Sheets → Authenticate

2. **Activate WF2** (1 min)
   - Find workflow → Click Activate

3. **Run test** (5 min)
   - Execute button or: `node wf2-test-simple.js`

4. **Monitor results** (daily)
   - Check Google Sheet for status updates
   - Review Slack notifications (if configured)

---

**Ready to activate!** Follow the 3 steps above.

Questions or issues? Check the detailed guides in this directory.
