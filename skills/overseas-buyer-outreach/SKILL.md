---
name: overseas-buyer-outreach
description: >
  Automated daily B2B outreach to overseas companies that could buy or distribute Japanese products.
  MGC acts as a Japan-based sourcing/trading partner. Finds companies via web research,
  discovers contact emails, generates personalized pitches, sends via n8n SMTP, and logs results.
  Trigger: "run outreach", "send buyer emails", "overseas-buyer-outreach", or cron schedule.
---

# Overseas Buyer Outreach — Daily B2B Email Campaign

MGC sources and supplies Japanese products to overseas buyers. This skill runs the daily outreach pipeline:
research → contact discovery → email generation → send → log.

## Sender Info
- **Name**: Jayden Barnes
- **Title**: VP of Growth, MGC inc.
- **Email**: jayden.barnes@mgc-global01.com
- **Company**: MGC inc. (Japan-based trading & sourcing company)

## MGC Value Proposition
MGC is a Japan-based trading company that sources high-quality Japanese products (health & wellness,
beauty, food & beverage, industrial tools, crafts) and supplies them to overseas distributors,
retailers, and Amazon/eCommerce sellers. We handle sourcing, QC, export documentation, and logistics.

## Email Webhook
**POST** `https://mgc-pass-proxy.duckdns.org/n8n/webhook/overseas-buyer-email`
```json
{
  "to": "contact@company.com",
  "subject": "Japanese [category] products for [Company]",
  "body": "plain text email body",
  "body_html": "<p>HTML version</p>",
  "company": "Company Name"
}
```

## Daily Limits
- Max **8 emails per run** (anti-spam)
- Skip companies already in `logs/sent.json`
- Run once per day via cron

## Target Profile
Overseas companies (US, UK, AU, CA, EU) that:
- Import or distribute health/wellness products
- Sell on Amazon/eBay/Etsy (Japanese goods niche)
- Are specialty food importers (Japanese food, matcha, sake)
- Are beauty/cosmetics distributors interested in J-beauty
- Are industrial tools importers/distributors
- Operate Japanese-themed or Asia-focused retail stores

## Workflow

### Step 1 — Load Sent Log
Read `logs/sent.json`. Extract list of already-contacted emails/domains.

### Step 2 — Research Target Companies
Use web search (Serper) to find fresh targets. Rotate categories each run.

**Search queries (rotate):**
- `"Japanese health products" importer distributor USA contact`
- `"Japanese beauty products" wholesale distributor UK Australia`
- `"Japanese food" importer specialty grocer USA Canada`
- `"Japanese tools" supplier distributor North America`
- `Japanese goods Amazon seller wholesale supplier`
- `matcha wholesale importer USA Europe`
- `Japanese wellness products distributor B2B`

Search for 15-20 companies. For each, collect:
- Company name
- Website URL
- Country
- Category (health/beauty/food/tools/general)
- Brief description

### Step 3 — Find Contact Emails
For each company website, crawl the `/contact`, `/about`, `/team` pages to find:
- Direct personal email (e.g., john@company.com) ← PREFERRED
- Generic contact email (e.g., info@, hello@, purchasing@) ← acceptable if no personal found

Skip companies where no email can be found after checking 2-3 pages.
Skip companies already in `logs/sent.json` (by domain).

Target: find **8 contactable companies** per run.

### Step 4 — Generate Personalized Email
For each company, write a short, punchy email. **Max 120 words.** No fluff.

**Template guidance:**
- Line 1: Reference something specific about their business (product niche, region, what they sell)
- Line 2-3: MGC's offer — "We source [specific category] products directly from Japanese manufacturers and supply to overseas distributors."
- Line 4: Concrete hook — "We're currently working with 3 new suppliers in [category] with no MOQ for first orders."
- Line 5: CTA — One simple question to prompt a reply. E.g., "Would you be open to a quick call this week?"
- Sign off: Jayden Barnes | VP of Growth | MGC inc. | jayden.barnes@mgc-global01.com

**Subject line formula:** `Japanese [category] sourcing — [Company Name]`

**Tone:** Professional, direct, not salesy. Treat them as a peer.

### Step 5 — Send via n8n Webhook
POST to `https://mgc-pass-proxy.duckdns.org/n8n/webhook/overseas-buyer-email`

Use `curl` or Python `requests`. Example:
```bash
curl -s -X POST https://mgc-pass-proxy.duckdns.org/n8n/webhook/overseas-buyer-email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "EMAIL",
    "subject": "SUBJECT",
    "body": "PLAIN TEXT",
    "body_html": "<p>HTML</p>",
    "company": "COMPANY NAME"
  }'
```

### Step 6 — Update Sent Log
Append each sent email to `logs/sent.json`:
```json
[
  {
    "date": "2026-04-12",
    "company": "Company Name",
    "email": "contact@company.com",
    "domain": "company.com",
    "country": "USA",
    "category": "health",
    "subject": "Japanese health products sourcing — Company Name"
  }
]
```

### Step 7 — Report to Slack
After all emails sent, post summary to Slack DM (U0AM9DC9SJW):
```
📧 Outreach complete — [DATE]
Sent: X emails
Companies: [list of company names]
Categories: health (2), beauty (3), food (1), tools (2)
```

## Error Handling
- If webhook returns non-200: log the error, skip that company, continue with the rest
- If web crawl fails: skip that company, move to the next
- If < 4 companies found with valid emails: send a Slack alert to Jayden, run again tomorrow

## Config File
`config/config.json`:
```json
{
  "daily_limit": 8,
  "webhook_url": "https://mgc-pass-proxy.duckdns.org/n8n/webhook/overseas-buyer-email",
  "slack_dm": "U0AM9DC9SJW",
  "sender_email": "jayden.barnes@mgc-global01.com",
  "sender_name": "Jayden Barnes",
  "categories_rotation": ["health", "beauty", "food", "tools", "general"],
  "last_category_index": 0
}
```

## Cron Schedule
Runs daily at **09:00 JST** via mechatron cron.
Label: `overseas-buyer-outreach`
