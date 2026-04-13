# WF2 Setup Guide — Google Sheets + Form Server Integration

**Date:** 2026-04-12  
**Status:** Ready for configuration  
**Form Server:** ✅ Running on localhost:3456 (DRY_RUN mode)

---

## Quick Start Checklist

- [ ] **Step 1:** Verify/create Google Sheets credentials in n8n
- [ ] **Step 2:** Activate WF2 workflow (ID: `EJ55iETQ1uYKKHMu`)
- [ ] **Step 3:** Create test Google Sheet with sample data
- [ ] **Step 4:** Test workflow trigger
- [ ] **Step 5:** Verify form server received the request

---

## Architecture Recap

```
Google Sheets (Companies)
    ↓
n8n WF2 Workflow (Scheduled or Manual Trigger)
    ↓ (For each row)
Form Server (localhost:3456) ← Finds & fills contact forms
    ↓
Update Sheet Status Column (sent → completed/failed)
```

---

## Step 1: Google Sheets Credential Setup

### Option A: Use Existing Credential (if already in n8n)

1. Open n8n: `http://mgc-pass-proxy.duckdns.org:5678`
2. Go to **Credentials** (left sidebar)
3. Look for "Google Sheets" (OAuth type)
4. If found: Note the credential name and copy it to WF2 nodes

### Option B: Create New OAuth Credential

1. In n8n, click **Credentials** → **New**
2. Select **Google Sheets** → **Create new credential**
3. Click **"Authenticate with Google"**
4. Sign in with your Google account (jayden.barnes@mgc-global01.com or Jayden's personal Google)
5. Grant permission to:
   - Access Google Sheets
   - Create and edit spreadsheets
6. Click **Save**
7. Name it: `Google Sheets OAuth - Jayden`

### Option C: Use Service Account (if available)

If Jayden has a Google Cloud service account JSON file:
1. n8n → **Credentials** → **New**
2. Select **Google Sheets** → **Authentication: Service Account (JSON file)**
3. Upload the JSON file from `~/.google/service-account.json` or similar
4. Save as: `Google Sheets Service Account`

**Note:** Service account approach is more reliable for automated workflows.

---

## Step 2: Activate WF2 Workflow

### Via n8n UI

1. Open n8n: `http://mgc-pass-proxy.duckdns.org:5678`
2. Go to **Workflows**
3. Search for or find workflow ID: `EJ55iETQ1uYKKHMu`
4. Open the workflow
5. Click **Activate** button (top right)
6. Confirm the activation

### Via API

```bash
# If you have the n8n API key (X-N8N-API-KEY)
curl -X POST http://mgc-pass-proxy.duckdns.org:5678/api/v1/workflows/EJ55iETQ1uYKKHMu/activate \
  -H "X-N8N-API-KEY: <YOUR_API_KEY>" \
  -H "Content-Type: application/json"
```

---

## Step 3: Create Test Google Sheet

### Manual Setup

1. Create new Google Sheet: `WF2 Test Data — 2026-04-12`
2. Create columns:
   ```
   A: Company Name
   B: Website
   C: Status
   D: Notes
   ```

3. Add test data (3-5 rows):
   ```
   | Company Name | Website | Status | Notes |
   |---|---|---|---|
   | Test Company 1 | https://example.com | 未送信 | Test |
   | Test Company 2 | https://example.org | 未送信 | Test |
   | Mutual Trading Co. | https://www.mutualtrading.com | 未送信 | Real company |
   ```

### Via n8n (Automated)

In your WF2 workflow, you can add a **Google Sheets** node to:
1. Append rows to the sheet
2. Update the Status column when form is submitted

---

## Step 4: Workflow Node Configuration

### Expected WF2 Nodes Structure

1. **Trigger** (Manual or Scheduled)
   - Type: Manual Trigger (for testing) or Cron (for automation)
   - Schedule: Weekly Monday 9 AM JST (for production)

2. **Read Spreadsheet**
   - Credential: Select your Google Sheets OAuth
   - Range: `Sheet1!A2:D1000` (skip header)
   - Output: Array of rows

3. **For Each** (Loop)
   - Items: `$.data` (from spreadsheet node)
   - Execute: inner nodes once per row

4. **HTTP Request** (Inside loop)
   - URL: `http://localhost:3456/submit-form`
   - Method: POST
   - Headers:
     ```
     Content-Type: application/json
     ```
   - Body:
     ```json
     {
       "url": "{{ $item.json.Website }}",
       "company_name": "{{ $item.json.CompanyName }}",
       "message": "Partnership inquiry text here..."
     }
     ```

5. **Set** (Parse response)
   - Extract: `success`, `fieldsFilled`, `submitted`, `error`

6. **Google Sheets Update** (Update Status)
   - Operation: Update cell
   - Range: Column C (Status)
   - Value: `{{ $node["Http Request"].json.success ? "送信済み" : "失敗" }}`

7. **Slack Notification** (Optional)
   - Send summary to channel or DM

---

## Step 5: Testing

### Test 1: Manual Trigger

1. In n8n, open WF2 workflow
2. Click **Execute Workflow** (▶ button)
3. Watch execution log for:
   - ✅ Spreadsheet read successfully
   - ✅ Loop processes all rows
   - ✅ Form server responds (should see HTTP 200)
   - ✅ Status column updates

### Test 2: Check Form Server Logs

```bash
# Check if form server is running
curl http://localhost:3456/health

# Check logs
tail -50 /tmp/form-server.log
```

Expected log output:
```
🦞 MGC Form Outreach Server — mode: 🟡 DRY RUN
🦞 Server running on http://localhost:3456
[POST] /submit-form → Company: Test Company 1
  Found form at: https://example.com/contact
  Filled 5 fields
  Response: 200 OK
```

### Test 3: Verify Status Updates

1. Go back to your Google Sheet
2. Check Status column (Column C)
3. Should see:
   - `送信済み` (sent) for successful forms
   - `失敗` (failed) for errors/no form found

---

## Common Issues & Fixes

### Issue: "Google Sheets credential not found"
**Solution:** 
- Go to n8n Credentials → Ensure OAuth credential is created and authorized
- If using service account: Ensure JSON file is uploaded

### Issue: "Form server returns 'No fillable form fields found'"
**Reason:** Target website doesn't have standard HTML forms (likely iframe or custom JS form)
**Solution:** 
- For testing, use a known good site like Formspree: `https://formspree.io`
- Or use DRY_RUN mode to verify detection

### Issue: "Status column not updating"
**Solution:**
- Check Google Sheets node is configured with correct row range
- Verify OAuth credential has write permissions
- Run manual test and check execution logs

### Issue: "Workflow won't activate"
**Solution:**
- Check for missing node configurations (red X indicators)
- Ensure all credentials are linked properly
- Try re-saving the workflow before activating

---

## Production Checklist

When ready to move from testing to production:

- [ ] Run DRY_RUN against 10-20 companies
- [ ] Verify status updates work in Google Sheets
- [ ] Extract successful companies (forms found) to whitelist
- [ ] Switch to LIVE_MODE: Set env `LIVE_MODE=true` for form server
- [ ] Run LIVE submission on whitelisted subset
- [ ] Monitor for 24 hours for spam/blocking issues
- [ ] Set up Slack notifications for daily summaries
- [ ] Schedule weekly runs: Monday 9 AM JST

---

## Files & References

- **Form Server:** `/Users/jayden.csai/clawd/form-outreach/server.js`
- **Integration Guide:** `/Users/jayden.csai/clawd/form-outreach/n8n-integration-guide.md`
- **Architecture:** `/Users/jayden.csai/clawd/form-outreach/ARCHITECTURE.md`
- **n8n Workflows:** `http://mgc-pass-proxy.duckdns.org:5678`

---

## Next Steps

1. **Immediate:** Follow Step 1-5 above
2. **Day 1:** Verify all tests pass
3. **Week 1:** Run on full 257-company list in DRY_RUN
4. **Week 2:** Switch to LIVE_RUN on successful subset
5. **Month 1:** Monitor results, optimize message templates

---

**Created by:** OpenClaw Agent  
**Questions?** Check `form-outreach/n8n-integration-guide.md` for more details.
