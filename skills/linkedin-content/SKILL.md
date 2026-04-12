---
name: linkedin-content
description: >
  LinkedIn content generation pipeline for Jayden. Three modes:
  1) jayden-context: research Jayden's recent work/AI experiences → draft post
  2) web-scout: find interesting AI/app/tech stories online or in Slack → draft post
  3) linkedin-strategy: research top LinkedIn creators → update strategy guide
  All drafts are saved to the Obsidian 2-queue folder for review before posting.
---

# LinkedIn Content Pipeline

Generates LinkedIn post drafts for Jayden Barnes (VP of Growth, MGC inc.) and saves them
to the Obsidian queue for review. Continuous 改善 — reads the strategy guide first, always.

## Paths
- **Queue (output)**: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/MGC/2-queue/`
- **Strategy guide**: `~/clawd/memory/linkedin-strategy.md`
- **Jayden's daily notes**: `~/clawd/memory/YYYY-MM-DD.md`

## Jayden's Profile (for post voice/context)
- VP of Growth at MGC inc. — Japan-based AI-native trading company
- Background: Computer Science (Adelaide), JLPT N1, 8+ years B2B sales in Japan
- Past: Lalamove BD Lead, Southco Key Account Manager (JR, Hitachi, Toshiba, Fujitsu, TEL, Isuzu)
- Now: Building AI agent teams that automate overseas expansion for Japanese companies
- Based in Osaka, married to a Japanese woman, loves isekai web novels
- Authentic voice: direct, pragmatic, no hype — shares real lessons from the field

---

## Mode 1 — Jayden Context (Daily cron, 07:00 JST)

**Goal**: Turn Jayden's actual day-to-day work into LinkedIn insights.

### Step 1 — Load context
1. Read `~/clawd/memory/linkedin-strategy.md` (current viral format guidelines)
2. Read today's daily note: `~/clawd/memory/YYYY-MM-DD.md`
3. Read yesterday's daily note
4. Search memory for this week's activities: `mechatron-memory-search ~/clawd "this week work MGC"`

### Step 2 — Identify post-worthy moments
Look for:
- Problems solved with AI (specific tools, workflows)
- Client interactions / sales insights
- Surprises or counterintuitive findings
- "I used to think X, now I think Y" moments
- Behind-the-scenes of building an AI company in Japan

### Step 3 — Draft 1-2 LinkedIn posts
Apply the strategy guide format. Write in Jayden's voice:
- First-person, direct
- Specific > generic (name the tool, the client industry, the outcome)
- End with a thought-provoking question or observation

### Step 4 — Save to queue
Write each post as a `.md` file to the queue folder:
```
---
created_at: <ISO timestamp>
source: jayden-context
topic: <3-5 word topic>
status: draft
---

<full LinkedIn post text>
```
Filename: `jayden-<YYYYMMDD>-<slug>.md`

---

## Mode 2 — Web Scout (Daily cron, 08:00 JST)

**Goal**: Find genuinely interesting things happening in AI/tech/startups and frame them through Jayden's lens.

### Step 1 — Load strategy
Read `~/clawd/memory/linkedin-strategy.md`

### Step 2 — Search for interesting content (pick 2-3 sources per run, rotate)

**Web searches** (use Serper):
- `site:x.com "I built" AI app impressive 2025 2026`
- `"indie hacker" built AI tool viral this week`
- `Japanese company AI automation interesting`
- `AI agent startup launched 2026`
- `"we automated" business AI results`

**Slack channels** (read recent 20 messages):
- `#mgc-all` (C09DR06AY3V)
- Any @Agent activity that's newsworthy

**Apify Twitter search** (if web not enough):
- Search: `AI app built solo launched` (last 3 days)

### Step 3 — Select 1 best story
Pick the most surprising / useful / counter-narrative story.
Crawl the original post/article for full context.

### Step 4 — Draft a LinkedIn post
Frame it through Jayden's perspective:
- "I came across this today..."
- "This made me think about..."
- Add his take — connect it to Japan, AI agents, MGC's work, B2B sales
- Don't just share — add opinion

### Step 5 — Save to queue
```
---
created_at: <ISO timestamp>
source: web-scout
source_url: <original URL>
topic: <3-5 word topic>
status: draft
---

<full LinkedIn post text>
```
Filename: `scout-<YYYYMMDD>-<slug>.md`

---

## Mode 3 — LinkedIn Strategy Research (Weekly cron, Sunday 06:00 JST)

**Goal**: Keep the strategy guide up to date by researching what's actually working on LinkedIn right now.

### Step 1 — Research top LinkedIn creators in Jayden's space
Search for LinkedIn posts with high engagement in:
- AI / AI agents / automation
- Japan business / overseas expansion
- B2B sales / growth
- Founder / startup stories

Use Serper: `site:linkedin.com "10,000 likes" OR "5,000 comments" AI 2026`
Use web crawl on those posts to get full content.

Look for 5-10 high-engagement posts. For each, note:
- Hook (first 2 lines)
- Format (list / story / opinion / data)
- Length (words)
- Ending (question / CTA / statement)
- What emotion it triggers

### Step 2 — Synthesize patterns
Find what's working NOW:
- Common hook structures
- Post length sweet spot
- Use of line breaks / white space
- Hashtag patterns
- Timing patterns (if visible)

### Step 3 — Update strategy guide
Overwrite `~/clawd/memory/linkedin-strategy.md` with fresh findings.
Keep it concise — this is a living document for crons 1 & 2 to read.

### Step 4 — Notify Jayden
Send Slack DM to U0AM9DC9SJW with a 3-bullet summary of what changed.

---

## Queue File Format (canonical)
```markdown
---
created_at: 2026-04-12T09:00:00.000Z
source: jayden-context | web-scout
source_url: https://... (web-scout only)
topic: AI automation Japan sales
status: draft
---

[LinkedIn post text here]
```

## 改善 Protocol
After each run, consider:
- Did any post feel generic? Make the prompt more specific next time
- Did the strategy guide have gaps? Note them for Sunday's research run
- Is Jayden getting replies/comments on posted content? If so, note the pattern in the strategy guide
