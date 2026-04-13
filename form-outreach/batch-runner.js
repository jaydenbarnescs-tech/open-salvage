#!/usr/bin/env node
/**
 * MGC Form Outreach Batch Runner
 * Reads CSV of target companies and submits contact forms via the server
 * Usage: node batch-runner.js --csv <file> [--limit 5] [--dry-run] [--delay 30]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const SERVER_URL = 'http://localhost:3456/submit-form';
const DEFAULT_DELAY_MIN = 30; // seconds between submissions
const DEFAULT_DELAY_MAX = 60;
const RESULTS_DIR = path.join(__dirname, 'results');
const LOG_FILE = path.join(RESULTS_DIR, `batch_${new Date().toISOString().slice(0,10)}.json`);

// ─── MESSAGE PATTERNS (select by setting PATTERN env var: 1-6) ────────────
// Pattern 1 (DEFAULT): Hybrid - Authority + Pain Point (recommended by @Agent)
const PATTERNS = {
  1: `Hi,

I'm Jayden from MGC Inc. We work directly with Japanese manufacturers across multiple categories and track what's actually happening on the supply side.

Companies importing from Japan often hit the same invisible wall: it's rarely about price. It's usually lead time miscommunication, MOQ rigidity, or documentation gaps that slow things down. These rarely show up in a catalog.

I've helped a handful of buyers recently work through these exact issues. Happy to share what we found. 10 minutes, no pitch, just field notes.

Worth a quick call?

Jayden Barnes
VP of Growth - MGC Inc.
jayden.barnes@mgc-global01.com`,

  // Pattern 2: Sourcing cost angle
  2: `Hi,

I came across your company while researching buyers who import from Japan. Impressive product range.

Quick question: do you ever run into issues with pricing, MOQs, or communication gaps with your Japanese suppliers?

We specialize in supporting overseas buyers on exactly these pain points, completely free. We work on the supplier side, so helping buyers like you costs us nothing.

Worth a 15-min call?

Jayden Barnes
MGC Inc.
jayden.barnes@mgc-global01.com`,

  // Pattern 3: Language barrier angle
  3: `Hi,

Sourcing from Japan is powerful, but the language barrier and supplier communication can quietly cost you money.

We help overseas buyers navigate exactly this. Negotiation support, supplier audits, finding better alternatives, all free to buyers, because we work on the supplier growth side.

Happy to share what we're seeing in your product category. Interested?

Jayden Barnes
MGC Inc.
jayden.barnes@mgc-global01.com`,

  // Pattern 4: Low-pressure research framing
  4: `Hi,

I'm mapping how leading Japan importers manage their supply chains, and your company stood out.

We're offering free sourcing consultations to serious Japan buyers right now. No pitch, just a conversation where we share what we're seeing on the supplier side.

Open to a quick call?

Jayden Barnes
MGC Inc.
jayden.barnes@mgc-global01.com`,

  // Pattern 5: Better suppliers exist
  5: `Hi,

Many Japan importers we talk to are unknowingly paying above market because they've been with the same supplier for years.

We're happy to do a free review of your current Japan supply chain. No obligation, just a fresh perspective.

Worth 15 minutes?

Jayden Barnes
MGC Inc.
jayden.barnes@mgc-global01.com`,

  // Pattern 6: Market timing angle
  6: `Hi,

Japan's export landscape is shifting right now with new supplier incentives creating some good opportunities for buyers who move early.

We're talking to a handful of serious Japan importers to share what we're seeing. Free, no agenda.

Want in?

Jayden Barnes
MGC Inc.
jayden.barnes@mgc-global01.com`,
};

const SELECTED_PATTERN = parseInt(process.env.PATTERN || '1');
const MESSAGE = PATTERNS[SELECTED_PATTERN] || PATTERNS[1];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { csv: null, limit: null, dryRun: false, delay: null, assignedTo: null, out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv') opts.csv = args[++i];
    if (args[i] === '--limit') opts.limit = parseInt(args[++i]);
    if (args[i] === '--dry-run') opts.dryRun = true;
    if (args[i] === '--delay') opts.delay = parseInt(args[++i]);
    if (args[i] === '--assigned-to') opts.assignedTo = args[++i];
    if (args[i] === '--out') opts.out = args[++i];
  }
  return opts;
}

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    // Handle quoted fields with commas
    const fields = [];
    let inQuotes = false, current = '';
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    fields.push(current.trim());
    return Object.fromEntries(headers.map((h, i) => [h, fields[i] || '']));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randomDelay(minSec, maxSec) {
  return Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
}

function postJSON(url, data, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ raw }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Request timed out after ' + timeoutMs + 'ms')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  if (!opts.csv) {
    console.error('Usage: node batch-runner.js --csv <file.csv> [--limit 5] [--dry-run] [--assigned-to "Jayden"]');
    process.exit(1);
  }

  if (!fs.existsSync(opts.csv)) {
    console.error(`CSV not found: ${opts.csv}`);
    process.exit(1);
  }

  // Check server health
  try {
    const health = await postJSON('http://localhost:3456/health', {}).catch(() => null);
    // GET instead
    const r = await new Promise((res, rej) => {
      http.get('http://localhost:3456/health', resp => {
        let d = ''; resp.on('data', c => d += c); resp.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });
    console.log(`✅ Server healthy — mode: ${r.mode}`);
    if (r.mode === 'DRY_RUN' && !opts.dryRun) {
      console.log('ℹ️  Server is in DRY_RUN mode (restart with LIVE_MODE=true to submit)');
    }
  } catch (e) {
    console.error('❌ Server not running on port 3456. Start it first: node server.js');
    process.exit(1);
  }

  ensureDir(RESULTS_DIR);

  const tag = path.basename(opts.csv, '.csv').replace(/MGC_Target_Companies_/, '').toLowerCase();
  const LOG_FILE = opts.out || path.join(RESULTS_DIR, `batch_${new Date().toISOString().slice(0,10)}_${tag}.json`);

  let companies = parseCSV(opts.csv);
  console.log(`📋 Loaded ${companies.length} companies from ${path.basename(opts.csv)}`);

  // Filter by assignee if specified
  if (opts.assignedTo) {
    companies = companies.filter(c =>
      (c['Assigned To'] || '').toLowerCase().includes(opts.assignedTo.toLowerCase())
    );
    console.log(`🔍 Filtered to ${companies.length} companies assigned to "${opts.assignedTo}"`);
  }

  // Apply limit
  if (opts.limit) {
    companies = companies.slice(0, opts.limit);
    console.log(`🔢 Limited to first ${companies.length} companies`);
  }

  const minDelay = opts.delay || DEFAULT_DELAY_MIN;
  const maxDelay = opts.delay ? opts.delay + 15 : DEFAULT_DELAY_MAX;

  console.log(`\n🚀 Starting batch outreach — ${companies.length} companies`);
  console.log(`   Delay: ${minDelay}–${maxDelay}s between submissions`);
  console.log(`   Results: ${LOG_FILE}\n`);

  const results = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < companies.length; i++) {
    const co = companies[i];
    const website = co['Website'] || co['website'] || '';
    const name = co['Company Name'] || co['company_name'] || co['name'] || '';

    if (!website) {
      console.log(`[${i + 1}/${companies.length}] ⏭️  ${name} — no website, skipping`);
      results.push({ company: name, website: '', status: 'skipped', reason: 'no website' });
      continue;
    }

    const url = website.startsWith('http') ? website : `https://${website}`;
    console.log(`[${i + 1}/${companies.length}] 🌐 ${name} — ${url}`);

    try {
      const result = await postJSON(SERVER_URL, {
        url,
        company_name: name,
        message: MESSAGE
      });

      const entry = {
        timestamp: new Date().toISOString(),
        company: name,
        website: url,
        formUrl: result.formUrl,
        fieldsFilled: result.fieldsFilled,
        submitted: result.submitted,
        mode: result.mode,
        status: result.success ? 'ok' : 'failed',
        error: result.error || null,
        note: result.note
      };

      results.push(entry);

      if (result.success) {
        successCount++;
        const icon = result.submitted ? '✅' : '📝';
        console.log(`   ${icon} Fields filled: ${result.fieldsFilled} | Submitted: ${result.submitted} | ${result.note}`);

        // ── After success: update Google Sheet via local /update-sheet endpoint ──
        if (result.submitted) {
          try {
            await postJSON('http://localhost:3456/update-sheet', {
              company: name,
              formUrl: result.formUrl,
              status: `Form Sent ${new Date().toISOString().slice(0, 10)}`
            }, 20000);
            console.log(`   📊 Sheet updated: ${name}`);
          } catch (sheetErr) {
            console.log(`   ⚠️  Sheet update failed: ${sheetErr.message}`);
          }

          // ── Also notify n8n webhook → Slack ──
          postJSON('http://mgc-pass-proxy.duckdns.org:5678/webhook/form-outreach-result', {
            company: name, website: url, formUrl: result.formUrl,
            fieldsFilled: result.fieldsFilled, submitted: true
          }, 10000).catch(() => {}); // fire-and-forget
        }
      } else {
        errorCount++;
        console.log(`   ⚠️  Failed: ${result.error || 'no fields found'}`);
      }
    } catch (e) {
      errorCount++;
      console.log(`   ❌ Request error: ${e.message}`);
      results.push({ timestamp: new Date().toISOString(), company: name, website: url, status: 'request_error', error: e.message });
    }

    // Save results after each company
    fs.writeFileSync(LOG_FILE, JSON.stringify({ summary: { total: companies.length, success: successCount, errors: errorCount }, results }, null, 2));

    // Rate limit delay (skip after last item)
    if (i < companies.length - 1) {
      const delay = randomDelay(minDelay, maxDelay);
      console.log(`   ⏱  Waiting ${(delay / 1000).toFixed(0)}s before next...\n`);
      await sleep(delay);
    }
  }

  console.log(`\n✅ Batch complete!`);
  console.log(`   Success: ${successCount} | Errors: ${errorCount} | Total: ${companies.length}`);
  console.log(`   Full results: ${LOG_FILE}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
