// ~/claude-agent/linkedin-watcher.js
// Watches Obsidian inbox for new voice notes, polishes via Claude CLI, saves to linkedin/

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const chokidar = require('chokidar');

// --- Config ---
const VAULT = path.join(
  process.env.HOME,
  'Library/Mobile Documents/iCloud~md~obsidian/Documents/MGC'
);
const INBOX = path.join(VAULT, 'inbox');
const LINKEDIN = path.join(VAULT, 'linkedin');
const CLAUDE = path.join(process.env.HOME, 'bin/claude');
const LOG_DIR = path.join(process.env.HOME, 'claude-agent/logs');
const LOG_FILE = path.join(LOG_DIR, 'linkedin.log');
const DEBOUNCE_MS = 3000;

// --- Logging ---
fs.mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// --- Track processed files to avoid duplicates ---
const processed = new Set();

// --- Claude polishing prompt ---
const PROMPT = `You are a LinkedIn ghostwriter for a founder.
You will receive a raw voice note transcript.
Your job is to turn it into a compelling LinkedIn post.

Rules:
- Keep the author's authentic voice — do NOT make it sound corporate or generic
- Max 1300 characters (LinkedIn sweet spot)
- No hashtag spam — max 3 relevant hashtags at the end if they add value
- Hook on line 1 — make it impossible to scroll past
- Short punchy paragraphs — max 2-3 lines each
- No cringe phrases like "game-changer", "excited to share", "thrilled to announce"
- End with a question or thought that invites comments
- Output ONLY the final post text, nothing else — no preamble, no "Here's the post:"

Raw voice note:
`;

// --- Process a new inbox file ---
async function processFile(filePath) {
  const filename = path.basename(filePath);

  // Skip hidden, draft, test, and non-md files
  if (filename.startsWith('_') || filename.startsWith('.')) return;
  if (filename === 'test-note.md') return;
  if (!filename.endsWith('.md')) return;
  if (processed.has(filePath)) return;

  processed.add(filePath);
  log(`New file detected: ${filename}`);

  // Debounce — wait for iCloud sync
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));

  // Read the file content
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log(`ERROR reading ${filename}: ${err.message}`);
    return;
  }

  // Strip YAML frontmatter if present
  const stripped = content.replace(/^---[\s\S]*?---\n*/, '').trim();
  if (!stripped) {
    log(`WARN: ${filename} is empty after stripping frontmatter, skipping`);
    return;
  }

  log(`Processing ${filename} (${stripped.length} chars)...`);

  // Call Claude CLI
  const fullPrompt = PROMPT + stripped;

  try {
    const polished = await new Promise((resolve, reject) => {
      execFile(
        CLAUDE,
        ['-p', fullPrompt, '--model', 'claude-sonnet-4-6', '--max-turns', '1'],
        { timeout: 120000, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(`Claude CLI failed: ${err.message}\n${stderr}`));
          resolve(stdout.trim());
        }
      );
    });

    // Validate output
    if (!polished || polished.length < 50) {
      log(`WARN: Claude output too short (${polished?.length || 0} chars) for ${filename}, skipping`);
      return;
    }

    log(`Claude returned ${polished.length} chars for ${filename}`);

    // Build tomorrow 8:00 AM JST
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const scheduled = `${tomorrow.toISOString().split('T')[0]}T08:00:00+09:00`;

    // Build output with frontmatter
    const output = [
      '---',
      `date: ${new Date().toISOString().split('T')[0]}`,
      'status: ready',
      `source_file: ${filename}`,
      `scheduled_for: ${scheduled}`,
      'posted: false',
      '---',
      '',
      polished,
      '',
    ].join('\n');

    // Save to linkedin/ folder
    const outPath = path.join(LINKEDIN, filename);
    fs.writeFileSync(outPath, output, 'utf-8');
    log(`Saved polished post to linkedin/${filename}`);

    // Post directly to LinkedIn API
    try {
      const creds = JSON.parse(fs.readFileSync(
        path.join(process.env.HOME, '.linkedin-credentials.json'), 'utf-8'));
      const https = require('https');
      const body = JSON.stringify({
        author: creds.person_urn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: polished },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'CONNECTIONS' }
      });
      const opts = {
        hostname: 'api.linkedin.com', path: '/v2/ugcPosts', method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + creds.access_token,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const req = https.request(opts, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => log('LinkedIn: HTTP ' + r.statusCode +
          (r.statusCode === 201 ? ' SUCCESS ✅' : ' ' + d.substring(0, 100))));
      });
      req.on('error', e => log('LinkedIn error: ' + e.message));
      req.write(body); req.end();
    } catch(e) { log('LinkedIn post error: ' + e.message); }
  } catch (err) {
    log(`ERROR processing ${filename}: ${err.message}`);
  }
}

// --- Start watcher ---
log('=== LinkedIn watcher started ===');
log(`Watching: ${INBOX}`);

const watcher = chokidar.watch(INBOX, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
});

watcher.on('add', (filePath) => {
  processFile(filePath).catch((err) => {
    log(`FATAL error processing ${filePath}: ${err.message}`);
  });
});

watcher.on('error', (err) => {
  log(`Watcher error: ${err.message}`);
});

process.on('SIGTERM', () => {
  log('=== LinkedIn watcher stopped (SIGTERM) ===');
  watcher.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  log('=== LinkedIn watcher stopped (SIGINT) ===');
  watcher.close();
  process.exit(0);
});
