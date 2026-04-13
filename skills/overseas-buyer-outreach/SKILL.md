---
name: overseas-buyer-outreach
description: >
  Automated daily B2B outreach to overseas companies that buy or distribute Japanese products.
  MGC acts as a Japan-based sourcing/trading partner. Uses high-quality lead sources (ImportYeti,
  trade show lists, Amazon seller research) to find verified buyers — not generic Google searches.
  Trigger: "run outreach", "send buyer emails", "overseas-buyer-outreach", or cron schedule.
---

# Overseas Buyer Outreach — Daily B2B Email Campaign

MGC sources and supplies Japanese products to overseas buyers. Pipeline:
lead discovery → contact enrichment → personalized email → send → log.

## Sender Info
- **Name**: Jayden Barnes
- **Title**: VP of Growth, MGC inc.
- **Email**: jayden.barnes@mgc-global01.com
- **Company**: MGC inc. (Japan-based trading & sourcing company)

## MGC Value Proposition
- Factory-direct pricing from Japanese manufacturers (no middlemen)
- No MOQ on first order — sample before committing ← **use this hook always**
- English support throughout + we handle export/customs paperwork
- Non-Alibaba sourcing: regional artisan brands, small-batch producers
- Exclusive distribution rights available for smaller brands

## Email Webhook
**POST** `https://mgc-pass-proxy.duckdns.org/n8n/webhook/overseas-buyer-email`
```json
{
  "to": "contact@company.com",
  "subject": "Japanese [category] — [Company Name]",
  "body": "plain text email body",
  "body_html": "<p>HTML version</p>",
  "company": "Company Name"
}
```

## Daily Limits
- Max **8 emails per run** (anti-spam)
- Skip companies already in `logs/sent.json`
- Run once per day via cron

---

## Ideal Customer Profiles (ICP)

Target ONE of these per run. Rotate daily.

### ICP A — Amazon Japan-Niche Seller (US / AU first)
- Amazon/DTC brand selling Japanese products, 1–15 employees, $300K–$3M revenue
- Pain: high MOQ, slow suppliers, no English support from Japanese makers
- Hook: "No MOQ first order. English communication throughout."
- Find via: Amazon seller research (search "Japanese skincare / matcha / kitchen tools" → find third-party sellers)

### ICP B — Regional Health/Natural Food Distributor (US / EU)
- Regional distributor supplying health food stores, 10–50 employees, $2M–$20M revenue
- Has or wants Japanese product lines (matcha, supplements, fermented foods)
- Pain: Japanese suppliers have high MOQs and no English support
- Hook: "Exclusive regional rights. We consolidate Japan shipments into one."
- Find via: JETRO buyer lists, Expo West exhibitor lists, Europages

### ICP C — Japanese Goods Specialty Importer (UK first, then US / AU)
- Already imports/retails Japanese goods — knows Japan, wants new exclusive brands
- Pain: limited supplier relationships, hard to find authentic small-batch brands
- Hook: "We find brands you can't find on Alibaba — small artisan, regional, factory-direct."
- Find via: ImportYeti (search Japan HS codes), Kompass directory

---

## Lead Sources (use in this priority order)

### 1. ImportYeti.com (FREE — use first)
US customs import data. Find companies already importing from Japan.

**HS codes to search:**
- `3304` — Beauty/skincare
- `2106` — Food supplements / health
- `8467` — Industrial handheld tools
- `8205` — Hand tools (general)
- `2101` — Green tea / matcha extracts
- `2208` — Japanese spirits (sake, shochu)

Go to importyeti.com → search by HS code + filter "country: Japan" → export company list.
These are **verified buyers** — they already import from Japan.

### 2. Amazon Seller Research
- Search Amazon for: "Japanese skincare," "matcha powder," "Japanese kitchen tools," "Japanese hand tools"
- Identify third-party sellers (not Amazon itself)
- Visit their storefront/website → find contact email on /contact or /about page
- Best targets: sellers with 50–500 reviews in a Japanese product category

### 3. Trade Show Exhibitor Lists (free, public)
- **Natural Products Expo West** (expowst.com) — health, beauty, food buyers
- **Fancy Food Show** (specialtyfood.com) — specialty food importers
- **NY NOW** (nynow.com) — gifts, crafts, lifestyle buyers
- Filter exhibitors for Japanese product categories or check booth descriptions

### 4. Web Search (fallback only — lower quality)
Use Serper only if the above sources yield fewer than 8 targets.
```
"Japanese [category]" importer distributor [country] contact email
site:importyeti.com japan [HS category]
```

### 5. Apollo.io (free tier: 50 exports/month)
- Search: `"Japan import" AND (buyer OR sourcing)` + country filter
- Title filters: Import Manager, Category Buyer, Sourcing Director, Founder
- Company size: 10–200 employees

---

## Workflow

### Step 1 — Load Sent Log + Choose ICP
```
Read logs/sent.json → extract already-contacted domains
Choose today's ICP (rotate A → B → C → A...)
Choose lead source based on ICP (ImportYeti for ICP C, Amazon for ICP A, trade shows for ICP B)
```

### Step 2 — Find Target Companies
Using the lead source appropriate for today's ICP:
- Pull 15–20 candidate companies
- For each: company name, website, country, category, what they sell/import

Skip if domain already in `logs/sent.json`.

### Step 3 — Find Contact Emails
For each company website, crawl `/contact`, `/about`, `/team`:
- Direct personal email (firstname@company.com) ← PREFERRED
- Generic (info@, purchasing@, hello@) ← acceptable fallback

Target: **8 contactable companies** per run.

### Step 4 — Generate Personalized Email

**Hard rules:**
- MAX 150 words. No exceptions.
- ALWAYS mention something specific about their business (their products, their market)
- ALWAYS include the "No MOQ first order" hook
- ONE call-to-action only: "15-min call?" or "Want our product list?"
- NO attachments, NO company history, NO "I hope this email finds you well"

**Subject line formulas (A/B test):**
- `Japanese [specific product] supplier — already exporting to [their country]`
- `Found your [Amazon store / website] — question about your Japan sourcing`
- `[Company name] — [specific product] direct from Japan, no MOQ`

**Email template:**
```
Hi [First Name],

Noticed [Company Name] sells [their specific product] — we source that
category direct from manufacturers in [specific Japan region].

MGC is a Japan-based trading company. We work with overseas buyers who want:
- Factory-direct pricing (no middlemen)
- No MOQ on first order — sample before committing
- English support + we handle export/customs paperwork

We currently supply [relevant category] to buyers in [their market].

Would a 15-minute call make sense? Happy to share our current product list.

Jayden Barnes
VP of Growth | MGC inc. | jayden.barnes@mgc-global01.com
```

**Tone:** Peer-to-peer. Not salesy. Assume they're busy.

### Step 5 — Send via n8n Webhook
```bash
curl -s -X POST https://mgc-pass-proxy.duckdns.org/n8n/webhook/overseas-buyer-email \
  -H "Content-Type: application/json" \
  -d '{"to":"EMAIL","subject":"SUBJECT","body":"PLAIN TEXT","body_html":"<p>HTML</p>","company":"COMPANY"}'
```

### Step 6 — Update Sent Log
Append to `logs/sent.json`:
```json
{
  "date": "2026-04-12",
  "company": "Company Name",
  "email": "contact@company.com",
  "domain": "company.com",
  "country": "USA",
  "category": "health",
  "icp": "A",
  "lead_source": "amazon_research",
  "subject": "Japanese matcha supplier — already exporting to USA"
}
```

### Step 7 — Report to Slack
```
📧 Outreach complete — [DATE]
ICP: [A/B/C] | Source: [importyeti/amazon/tradeshows]
Sent: X emails
Companies: [list]
Categories: health (2), beauty (3), food (1), tools (2)
```

---

## Error Handling
- Webhook non-200: log, skip, continue
- Web crawl fails: skip, next company
- < 4 companies found: Slack alert to Jayden, try different lead source tomorrow

## Config
`config/config.json`:
```json
{
  "daily_limit": 8,
  "webhook_url": "https://mgc-pass-proxy.duckdns.org/n8n/webhook/overseas-buyer-email",
  "slack_dm": "U0AM9DC9SJW",
  "sender_email": "jayden.barnes@mgc-global01.com",
  "sender_name": "Jayden Barnes",
  "icp_rotation": ["A", "B", "C"],
  "current_icp_index": 0,
  "categories_rotation": ["health", "beauty", "food", "tools", "crafts"],
  "last_category_index": 0
}
```

## Cron Schedule
Runs daily at **09:00 JST** via mechatron cron.
Label: `overseas-buyer-outreach`

## Weekly Targets
- 8 emails/day × 5 days = 40 emails/week
- Expected reply rate (good targeting): 8–15%
- Target: 3–6 warm replies per week
