'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Paths ─────────────────────────────────────────────────────────────────────
const VAULT    = process.env.HOME + '/Library/Mobile Documents/iCloud~md~obsidian/Documents/MGC';
const QUEUE    = VAULT  + '/2-queue/';
const POSTED   = VAULT  + '/3-posted/';
const HISTORY  = VAULT  + '/history/';
const CREDS    = process.env.HOME + '/.linkedin-credentials.json';
const LOG_DIR  = process.env.HOME + '/claude-agent/logs';
const LOG_FILE = LOG_DIR + '/linkedin.log';

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = new Date().toISOString() + '  ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ── YAML frontmatter helpers ──────────────────────────────────────────────────
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([\w_-]+):\s*(.*)/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body: match[2] };
}

function buildFrontmatter(meta) {
  return '---\n' + Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n';
}

// ── LinkedIn API ──────────────────────────────────────────────────────────────
function linkedinPost(creds, postContent) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      author: creds.person_urn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: postContent },
          shareMediaCategory: 'NONE'
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'CONNECTIONS'
      }
    });

    const options = {
      hostname: 'api.linkedin.com',
      path: '/v2/ugcPosts',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + creds.access_token,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Cross-volume safe move ────────────────────────────────────────────────────
function moveFile(src, dst) {
  try {
    fs.renameSync(src, dst);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(src, dst);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

// ── Renumber remaining queue files ───────────────────────────────────────────
function renumberQueue() {
  const files = fs.readdirSync(QUEUE)
    .filter(f => f.endsWith('.md'))
    .sort();

  files.forEach((file, idx) => {
    const newNum  = String(idx + 1).padStart(3, '0');
    const newName = file.replace(/^\d+/, newNum);
    if (newName !== file) {
      fs.renameSync(path.join(QUEUE, file), path.join(QUEUE, newName));
    }
  });

  log(`Renumbering done: ${files.length} file(s) remaining in queue`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('linkedin-poster: script started');

  // Ensure directories exist
  fs.mkdirSync(POSTED,  { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  // ── 1. Timing check (JST = UTC+9) ────────────────────────────────────────
  const nowUtcMs = Date.now();
  const jstMs    = nowUtcMs + 9 * 60 * 60 * 1000;
  const jstDate  = new Date(jstMs);
  const dowJST   = jstDate.getUTCDay(); // 0=Sun, 6=Sat

  if (dowJST === 0 || dowJST === 6) {
    log('Skipping: weekend');
    process.exit(0);
  }

  // 70% → 0-30 min delay, 30% → 90-120 min delay
  let delayMs;
  if (Math.random() < 0.7) {
    delayMs = Math.floor(Math.random() * 31) * 60 * 1000;       // 0–30 min
  } else {
    delayMs = (90 + Math.floor(Math.random() * 31)) * 60 * 1000; // 90–120 min
  }

  const postAtJST  = new Date(jstMs + delayMs);
  const postHH     = String(postAtJST.getUTCHours()).padStart(2, '0');
  const postMM     = String(postAtJST.getUTCMinutes()).padStart(2, '0');
  log(`Delay chosen: ${Math.round(delayMs / 60000)} min — will post at ${postHH}:${postMM} JST`);

  await new Promise(resolve => setTimeout(resolve, delayMs));

  // ── 2. Pick from queue ────────────────────────────────────────────────────
  const queueFiles = fs.readdirSync(QUEUE)
    .filter(f => f.endsWith('.md'))
    .sort();

  let chosenFile = null;
  for (const file of queueFiles) {
    const raw          = fs.readFileSync(path.join(QUEUE, file), 'utf8');
    const { meta }     = parseFrontmatter(raw);
    if (meta.status === 'ready') {
      chosenFile = file;
      break;
    }
  }

  if (!chosenFile) {
    log('No posts in queue');
    process.exit(0);
  }

  log(`Post picked: ${chosenFile}`);

  // ── 3. Extract post content ───────────────────────────────────────────────
  const filePath    = path.join(QUEUE, chosenFile);
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(fileContent);
  const postContent = body.trim();

  // ── 4. Post to LinkedIn ───────────────────────────────────────────────────
  const creds = JSON.parse(fs.readFileSync(CREDS, 'utf8'));

  log('Posting to LinkedIn...');
  const result = await linkedinPost(creds, postContent);
  log(`LinkedIn response status: ${result.status}`);

  if (result.status === 401) {
    log('Token expired - needs refresh');
    process.exit(1);
  }

  if (result.status !== 201) {
    log('LinkedIn error response: ' + result.body);
    process.exit(1);
  }

  // ── 5. Move to posted ─────────────────────────────────────────────────────
  meta.status           = 'posted';
  meta.posted_at        = new Date().toISOString();
  meta.linkedin_status  = '201';

  const updatedContent = buildFrontmatter(meta) + body;
  fs.writeFileSync(filePath, updatedContent, 'utf8');

  const destPath = path.join(POSTED, chosenFile);
  moveFile(filePath, destPath);
  log(`File moved to posted/: ${chosenFile}`);

  // ── 5b. Append posted section to history file ─────────────────────────────
  if (meta.history_file) {
    try {
      const historyPath = path.join(HISTORY, meta.history_file);
      let linkedinId = '';
      try {
        const parsed = JSON.parse(result.body);
        linkedinId = parsed.id || parsed.value || '';
      } catch (_) {}
      const historyAppend = [
        '',
        '## 📤 Posted',
        '',
        `posted_at: ${meta.posted_at}`,
        `linkedin_id: ${linkedinId}`,
        ''
      ].join('\n');
      fs.appendFileSync(historyPath, historyAppend);
      log(`History updated: ${meta.history_file}`);
    } catch (e) {
      log(`WARN: Could not update history file: ${e.message}`);
    }
  }

  // ── 6. Renumber remaining queue ───────────────────────────────────────────
  renumberQueue();

  log('linkedin-poster: script finished');
}

main().catch(err => {
  log('ERROR: ' + (err.stack || err.message || String(err)));
  process.exit(1);
});
