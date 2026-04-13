'use strict';

const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');

// --- Paths ---
const VAULT     = process.env.HOME + '/Library/Mobile Documents/iCloud~md~obsidian/Documents/MGC';
const INBOX     = VAULT + '/';
const QUEUE     = VAULT + '/2-queue/';
const PROCESSED = VAULT + '/1-processed/';
const HISTORY   = VAULT + '/history/';
const CLAUDE    = process.env.HOME + '/bin/claude';
const MECHATRON = process.env.HOME + '/bin/mechatron';
const LOG_DIR   = process.env.HOME + '/claude-agent/logs';
const LOG_FILE  = LOG_DIR + '/linkedin.log';

// --- PID file guard (prevent multiple instances) ---
const PID_FILE = '/tmp/linkedin-watcher.pid';
// Random jitter to spread out simultaneous launchctl spawns
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.floor(Math.random() * 400));
try {
  const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
  if (oldPid && oldPid !== process.pid) {
    try {
      process.kill(oldPid, 0); // throws if not running
      // Old instance is alive — exit self to avoid restart storm with launchd KeepAlive
      process.exit(0);
    } catch(_) {
      // Old process is gone — safe to continue
    }
  }
} catch(_) {}
fs.writeFileSync(PID_FILE, String(process.pid));
// Re-verify we won the race after a brief pause
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
try {
  const checkPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
  if (checkPid !== process.pid) { process.exit(0); }
} catch(_) { process.exit(0); }
process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch(_) {} });

// --- Ensure directories ---
fs.mkdirSync(QUEUE,     { recursive: true });
fs.mkdirSync(PROCESSED, { recursive: true });
fs.mkdirSync(HISTORY,   { recursive: true });
fs.mkdirSync(LOG_DIR,   { recursive: true });

// --- Duplicate tracking ---
const processing = new Set();
const processingLock = new Set();
const mdProcessingLock = new Set();

// --- Logging ---
function log(msg) {
  const line = new Date().toISOString() + ' ' + msg;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {
    console.error('Log write failed:', e.message);
  }
}

// --- Strip YAML frontmatter ---
function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n*/, '').trim();
}

// --- Parse YAML frontmatter manually ---
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

// --- Slugify first N words ---
function slugifyFirstWords(text, wordCount = 5) {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, wordCount)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled';
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

// --- Transcribe audio via ElevenLabs Scribe v2 ---
async function transcribeAudio(audioPath) {
  const { execFile } = require('child_process');
  const https = require('https');
  const fs = require('fs');
  const path = require('path');
  const ts = Date.now();
  const tmpAudio = `/tmp/scribe-src-${ts}${path.extname(audioPath)}`;

  // Copy to /tmp to bypass iCloud lock
  await new Promise((resolve, reject) => {
    execFile('cp', [audioPath, tmpAudio], err =>
      err ? reject(new Error('cp failed: ' + err.message)) : resolve()
    );
  });

  const audioData = fs.readFileSync(tmpAudio);
  try { fs.unlinkSync(tmpAudio); } catch(_) {}

  // POST to ElevenLabs Scribe v2
  return new Promise((resolve, reject) => {
    const boundary = '----ScribeBoundary' + Date.now();
    const ext = path.extname(audioPath).slice(1) || 'm4a';
    const mimeType = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.${ext}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
      ),
      audioData,
      Buffer.from(
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model_id"\r\n\r\nscribe_v2\r\n` +
        `--${boundary}--\r\n`
      )
    ]);

    const options = {
      hostname: 'api.elevenlabs.io',
      path: '/v1/speech-to-text',
      method: 'POST',
      headers: {
        'xi-api-key': 'sk_b3e7f55218bc15ebf3250aa4652403f688601c9067049256',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) {
            resolve(parsed.text.trim());
          } else {
            reject(new Error('No text in response: ' + data.slice(0, 200)));
          }
        } catch(e) {
          reject(new Error('Parse error: ' + e.message + ' raw: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Scribe timeout')); });
    req.write(body);
    req.end();
  });
}

// --- Run Claude CLI with spawn (stdin from /dev/null to avoid stdin warning) ---
function runClaude(prompt, options = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const maxTurns = options.maxTurns || '1';
    const model = options.model || 'claude-sonnet-4-6';
    const args = ['--task', 'linkedin', '--fresh', '-p', prompt, '--model', model, '--max-turns', maxTurns, '--dangerously-skip-permissions'];
    // OAuth token injection handled by mechatron internally
    const env = { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/jayden.csai/bin' };

    const child = spawn(MECHATRON, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Claude CLI timed out after 120s'));
    }, 120000);

    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const err = new Error(`Claude CLI exited with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// --- Read queue and build summary array ---
function readQueue() {
  let files;
  try {
    files = fs.readdirSync(QUEUE).filter(f => f.endsWith('.md')).sort();
  } catch (e) {
    return [];
  }
  return files.map(filename => {
    const fullPath = path.join(QUEUE, filename);
    let content = '';
    try { content = fs.readFileSync(fullPath, 'utf8'); } catch (e) { return null; }
    const fm = parseFrontmatter(content);
    const body = stripFrontmatter(content);
    const firstLine = (body.split('\n').find(l => l.trim()) || '').slice(0, 120);
    return {
      filename,
      fullPath,
      position: parseInt(fm.position || '0', 10) || 0,
      status: fm.status || 'ready',
      firstLine
    };
  }).filter(Boolean).sort((a, b) => a.position - b.position);
}

// --- Renumber all queue files, inserting new at decidedPosition ---
// Returns the final filename of the newly inserted file.
function renumberQueue(existingQueue, decidedPosition, newContent) {
  // Build ordered list: insert newContent at (decidedPosition - 1) index
  const insertIdx = Math.max(0, Math.min(decidedPosition - 1, existingQueue.length));

  // Read all existing file contents before any changes
  const existingContents = existingQueue.map(item => {
    try { return fs.readFileSync(item.fullPath, 'utf8'); } catch (e) { return null; }
  });

  // Build final ordered array: [content, isNew]
  const ordered = [];
  for (let i = 0; i < existingQueue.length; i++) {
    if (i === insertIdx) ordered.push({ content: newContent, isNew: true });
    if (existingContents[i] !== null) ordered.push({ content: existingContents[i], isNew: false, oldPath: existingQueue[i].fullPath });
  }
  if (insertIdx >= existingQueue.length) ordered.push({ content: newContent, isNew: true });

  // Write to temp files first to avoid name collisions
  const tmpDir = QUEUE;
  const stamp = Date.now();
  const tmpFiles = ordered.map((_, i) => path.join(tmpDir, `.tmp_${stamp}_${i}.md`));

  let savedFilename = null;

  // Write all temps
  ordered.forEach(({ content }, i) => {
    // Update position field in frontmatter
    const pos = i + 1;
    const updated = content.replace(/^(position:\s*)\d+/m, `$1${pos}`);
    fs.writeFileSync(tmpFiles[i], updated, 'utf8');
  });

  // Delete old files
  existingQueue.forEach(item => {
    try { fs.unlinkSync(item.fullPath); } catch (e) { /* ignore */ }
  });

  // Rename temps to final names
  ordered.forEach(({ content, isNew }, i) => {
    const pos = i + 1;
    const updated = content.replace(/^(position:\s*)\d+/m, `$1${pos}`);
    const body = stripFrontmatter(updated);
    const firstLine = body.split('\n').find(l => l.trim()) || '';
    const slug = slugifyFirstWords(firstLine);
    const fname = pad3(pos) + '-' + slug + '.md';
    const finalPath = path.join(QUEUE, fname);
    fs.renameSync(tmpFiles[i], finalPath);
    if (isNew) savedFilename = fname;
  });

  return savedFilename;
}

// --- Main processing pipeline ---
async function processFile(filePath) {
  const filename = path.basename(filePath);

  if (processing.has(filePath)) return;
  processing.add(filePath);

  log(`[DETECTED] ${filename}`);

  try {
    // 1. Read file with retry (force iCloud download if needed)
    let raw;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        raw = fs.readFileSync(filePath, 'utf8');
        break;
      } catch (e) {
        if (attempt === 1) {
          // Force iCloud to download the file
          try {
            const { execSync } = require('child_process');
            execSync(`brctl download "${filePath}"`, { timeout: 10000 });
          } catch (_) {}
        }
        log(`[RETRY] Cannot read ${filename} (attempt ${attempt}/5): ${e.message}`);
        if (attempt === 5) {
          // Last resort: try reading via cat command
          try {
            const { execSync } = require('child_process');
            raw = execSync(`cat "${filePath}"`, { encoding: 'utf8', timeout: 10000 });
            log(`[RECOVERED] Read ${filename} via cat fallback`);
            break;
          } catch (_) {
            log(`[ERROR] Giving up on ${filename} after 5 retries`);
            processing.delete(filePath);
            return;
          }
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    const strippedContent = stripFrontmatter(raw);
    if (!strippedContent) {
      log(`[SKIP] Empty after stripping frontmatter: ${filename}`);
      return;
    }
    const sourceMeta = parseFrontmatter(raw);
    const historyFile = sourceMeta.history_file || null;

    // 2. Polish & judge via Claude CLI (single call)
    log(`[POLISHING] ${filename}`);

    const polishPrompt =
      `You are a LinkedIn ghostwriter for a Japan-based founder. Read this voice note transcript and decide: does it contain enough real substance to become a LinkedIn post? (A real idea, opinion, story, lesson, observation — not a test, mic check, or meaningless content.)\n\n` +
      `If YES: Return ONLY a JSON object like this:\n` +
      `{"action": "queue", "post": "your polished LinkedIn post here"}\n\n` +
      `Rules for the post: authentic voice, max 1300 chars, max 3 hashtags only if truly needed, first line must stop the scroll, short punchy paragraphs, never use: game-changer/excited to share/thrilled to announce, end with a question or thought that invites comments.\n\n` +
      `If NO: Return ONLY a JSON object like this:\n` +
      `{"action": "skip", "reason": "brief reason why e.g. mic test, no content, too short"}\n\n` +
      `Transcript: ` + strippedContent;

    let claudeResult;
    try {
      const { stdout } = await runClaude(polishPrompt);
      const cleaned = stdout.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      claudeResult = JSON.parse(cleaned);
    } catch (e) {
      log(`[ERROR] Polish/judge failed for ${filename}: ${e.message}`);
      if (e.stderr) log(`[STDERR] ${String(e.stderr).slice(0, 500)}`);
      if (e.stdout) log(`[STDOUT] ${String(e.stdout).slice(0, 500)}`);
      return;
    }

    if (!claudeResult || !claudeResult.action) {
      log(`[ERROR] Invalid JSON from Claude for ${filename}`);
      return;
    }

    if (claudeResult.action === 'skip') {
      const skipReason = claudeResult.reason || 'no reason given';
      log(`[SKIPPED] ${filename} — ${skipReason}`);
      // Delete raw file from 1-processed/
      try {
        fs.unlinkSync(filePath);
        log(`[PROCESSED] Deleted raw file ${filename}`);
      } catch (e) {
        log(`[WARN] Could not delete raw file: ${e.message}`);
      }
      // Append skip to history
      if (historyFile) {
        try {
          const historyPath = path.join(HISTORY, historyFile);
          const skippedAt = new Date().toISOString();
          const historyAppend = [
            '',
            '## ⏭️ Skipped',
            '',
            `reason: ${skipReason}`,
            `skipped_at: ${skippedAt}`,
            ''
          ].join('\n');
          fs.appendFileSync(historyPath, historyAppend);
          log(`[HISTORY] Appended skip to ${historyFile}`);
        } catch (e) {
          log(`[WARN] Could not append skip to history: ${e.message}`);
        }
      }
      return;
    }

    // action === 'queue'
    const polished = claudeResult.post;
    if (!polished) {
      log(`[ERROR] Empty post content from Claude for ${filename}`);
      return;
    }
    log(`[POLISHED] ${filename} — ${polished.length} chars`);

    // 3. Read existing queue
    const existingQueue = readQueue();

    // 4. Ask Claude to decide queue position
    const queueSummaryJSON = JSON.stringify(
      existingQueue.map(q => ({
        filename: q.filename,
        position: q.position,
        status: q.status,
        firstLine: q.firstLine
      })),
      null, 2
    );

    const positionPrompt =
      `Given the NEW post and the EXISTING queue, decide what position (1-based) to insert the new post at. ` +
      `Timely/trending topics should cut to position 1-2. Evergreen content goes to the back. ` +
      `Never put two similar topics back-to-back. ` +
      `Respond with ONLY a JSON object: {"position": NUMBER, "reason": "brief reason"}\n\n` +
      `EXISTING QUEUE:\n${queueSummaryJSON}\n\n` +
      `NEW POST:\n${polished}`;

    let decidedPosition = existingQueue.length + 1;
    let queueReason = 'defaulted to end';

    try {
      const { stdout: posOut } = await runClaude(positionPrompt);

      const jsonMatch = posOut.match(/\{[\s\S]*?"position"[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.position === 'number' && parsed.position >= 1) {
          decidedPosition = Math.min(Math.max(Math.round(parsed.position), 1), existingQueue.length + 1);
          queueReason = parsed.reason || queueReason;
        }
      }
    } catch (e) {
      log(`[WARN] Position decision failed, defaulting to end: ${e.message}`);
    }

    log(`[QUEUE_POSITION] ${filename} → position ${decidedPosition} (${queueReason})`);

    // 5. Build new queue file content
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const polishedAt = now.toISOString();
    const scheduledFor = new Date(now.getTime() + (decidedPosition - 1) * 24 * 60 * 60 * 1000).toISOString();

    const newFileContent =
      `---\n` +
      `position: ${decidedPosition}\n` +
      `date: ${dateStr}\n` +
      `source_file: ${filename}\n` +
      `status: ready\n` +
      `polished_at: ${polishedAt}\n` +
      `queue_reason: "${queueReason.replace(/"/g, "'")}"\n` +
      (historyFile ? `history_file: ${historyFile}\n` : '') +
      `---\n\n` +
      polished + '\n';

    // 6. Insert into queue, renumber all files
    let savedFilename;
    try {
      savedFilename = renumberQueue(existingQueue, decidedPosition, newFileContent);
    } catch (e) {
      log(`[ERROR] Queue renumber failed: ${e.message}`);
      return;
    }

    log(`[SAVED] ${savedFilename} → queue/`);

    // 6b. Append polished post to history file
    if (historyFile) {
      try {
        const historyPath = path.join(HISTORY, historyFile);
        const historyAppend = [
          '',
          '## ✍️ Polished Post',
          '',
          polished,
          '',
          `queue_position: ${decidedPosition}`,
          `scheduled_for: ${scheduledFor}`,
          ''
        ].join('\n');
        fs.appendFileSync(historyPath, historyAppend);
        log(`[HISTORY] Appended polished post to ${historyFile}`);
      } catch (e) {
        log(`[WARN] Could not append to history file ${historyFile}: ${e.message}`);
      }
    }

    // 7. Delete raw file from 1-processed/
    try {
      fs.unlinkSync(filePath);
      log(`[PROCESSED] Deleted raw transcript ${filename}`);
    } catch (e) {
      log(`[WARN] Could not delete raw transcript: ${e.message}`);
    }

  } catch (e) {
    log(`[ERROR] Unexpected error processing ${filename}: ${e.message}`);
  } finally {
    processing.delete(filePath);
  }
}

// --- Watcher ---
const watcher = chokidar.watch(INBOX, {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 200
  },
  persistent: true,
  depth: 0
});

const debounceTimers = new Map();

function handleFile(filePath) {
  const basename = path.basename(filePath);
  if (!basename.endsWith('.md') && !basename.endsWith('.txt')) return;
  if (basename.startsWith('_') || basename.startsWith('.')) return;

  if (mdProcessingLock.has(filePath)) {
    log(`[MD] Already processing ${basename}, skipping duplicate`);
    return;
  }

  // Clear from processed set so edits get re-processed
  processing.delete(filePath);

  // Cancel previous timer for this file — restart the wait
  if (debounceTimers.has(filePath)) {
    clearTimeout(debounceTimers.get(filePath));
  }

  // 8-second debounce — resets on every edit so we only process once
  const timer = setTimeout(() => {
    debounceTimers.delete(filePath);
    mdProcessingLock.add(filePath);
    processFile(filePath).catch(e => {
      log(`[ERROR] Unhandled: ${e.message}`);
      processing.delete(filePath);
    }).finally(() => {
      mdProcessingLock.delete(filePath);
    });
  }, 8000);
  debounceTimers.set(filePath, timer);
}

// --- Audio file handler ---
async function handleAudioFile(filePath) {
  const filename = path.basename(filePath);
  if (filename.startsWith('.') || filename.startsWith('_')) return;
  // Skip files already in subfolders
  const relativePath = path.relative(VAULT, filePath);
  if (relativePath.includes('/')) return;

  if (processingLock.has(filePath)) {
    log(`[AUDIO] Already processing ${filename}, skipping duplicate`);
    return;
  }
  processingLock.add(filePath);

  try {
    log(`[AUDIO] Detected: ${filename}`);
    await new Promise(r => setTimeout(r, 3000)); // iCloud debounce

    // Check file still exists and has content
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < 1000) {
        log(`[AUDIO] Skipping ${filename} — too small (${stat.size} bytes)`);
        return;
      }
    } catch(e) {
      log(`[AUDIO] File gone: ${filename}`);
      return;
    }

    // Force iCloud to download the file before reading
    try {
      execSync(`brctl download "${filePath}"`, { timeout: 15000 });
      log(`[AUDIO] iCloud download triggered for ${filename}`);
    } catch(_) {}
    // Wait for download to complete (up to 30s)
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const st = fs.statSync(filePath);
        if (st.size > 0) break;
      } catch(_) {}
    }

    log(`[AUDIO] Transcribing ${filename} via ElevenLabs Scribe v2...`);

    let text;
    try {
      text = await transcribeAudio(filePath);
    } catch(e) {
      log(`[AUDIO] Transcription failed for ${filename}: ${e.message}`);
      return;
    }

    if (!text || text.length < 3) {
      log(`[AUDIO] Empty transcription for ${filename}`);
      return;
    }

    log(`[AUDIO] Transcribed ${filename} — ${text.length} chars`);

    // 1. Delete original .m4a
    fs.unlinkSync(filePath);
    log(`[AUDIO] Deleted ${filename} after transcription`);

    // 2. Save raw transcript to 1-processed/
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const mdFilename = `voice-${dateStr}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
    const rawPath = path.join(PROCESSED, `raw-${mdFilename}`);

    const rawContent = `---\ndate: ${dateStr}\ntime: ${timeStr}\nstatus: raw\nsource: voice\nhistory_file: ${mdFilename}\n---\n\n${text}\n`;
    fs.writeFileSync(rawPath, rawContent);
    log(`[AUDIO] Saved raw transcript → 1-processed/raw-${mdFilename}`);

    // Create history file
    const historyPath = path.join(HISTORY, mdFilename);
    const historyContent = [
      '---',
      `created_at: ${now.toISOString()}`,
      `source_file: ${filename}`,
      '---',
      '',
      '## 🎙️ Raw Transcript',
      '',
      text,
      ''
    ].join('\n');
    fs.writeFileSync(historyPath, historyContent);
    log(`[HISTORY] Created ${mdFilename}`);

    // 3. Polish & judge via Claude CLI (single call)
    log(`[AUDIO] Polishing raw transcript...`);
    const audioPolishPrompt =
      `You are a LinkedIn ghostwriter for a Japan-based founder. Read this voice note transcript and decide: does it contain enough real substance to become a LinkedIn post? (A real idea, opinion, story, lesson, observation — not a test, mic check, or meaningless content.)\n\n` +
      `If YES: Return ONLY a JSON object like this:\n` +
      `{"action": "queue", "post": "your polished LinkedIn post here"}\n\n` +
      `Rules for the post: authentic voice, max 1300 chars, max 3 hashtags only if truly needed, first line must stop the scroll, short punchy paragraphs, never use: game-changer/excited to share/thrilled to announce, end with a question or thought that invites comments.\n\n` +
      `If NO: Return ONLY a JSON object like this:\n` +
      `{"action": "skip", "reason": "brief reason why e.g. mic test, no content, too short"}\n\n` +
      `Transcript: ` + text;

    let audioResult;
    try {
      const { stdout } = await runClaude(audioPolishPrompt);
      const cleaned = stdout.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      audioResult = JSON.parse(cleaned);
    } catch (e) {
      log(`[AUDIO] Polish/judge failed: ${e.message}`);
      if (e.stderr) log(`[STDERR] ${String(e.stderr).slice(0, 500)}`);
      return;
    }

    if (!audioResult || !audioResult.action) {
      log(`[AUDIO] Invalid JSON from Claude`);
      return;
    }

    if (audioResult.action === 'skip') {
      const skipReason = audioResult.reason || 'no reason given';
      log(`[SKIPPED] raw-${mdFilename} — ${skipReason}`);
      // Delete raw file from 1-processed/
      try {
        fs.unlinkSync(rawPath);
        log(`[PROCESSED] Deleted raw file raw-${mdFilename}`);
      } catch (e) {
        log(`[WARN] Could not delete raw file: ${e.message}`);
      }
      // Append skip to history
      try {
        const skippedAt = new Date().toISOString();
        const skipAppend = [
          '',
          '## ⏭️ Skipped',
          '',
          `reason: ${skipReason}`,
          `skipped_at: ${skippedAt}`,
          ''
        ].join('\n');
        fs.appendFileSync(historyPath, skipAppend);
        log(`[HISTORY] Appended skip to ${mdFilename}`);
      } catch (e) {
        log(`[WARN] Could not append skip to history: ${e.message}`);
      }
      return;
    }

    // action === 'queue'
    const polished = audioResult.post;
    if (!polished) {
      log(`[AUDIO] Empty post content from Claude`);
      return;
    }
    log(`[AUDIO] Polished — ${polished.length} chars`);

    // 4. Read existing queue and decide position
    const existingQueue = readQueue();

    const queueSummaryJSON = JSON.stringify(
      existingQueue.map(q => ({
        filename: q.filename,
        position: q.position,
        status: q.status,
        firstLine: q.firstLine
      })),
      null, 2
    );

    const positionPrompt =
      `Given the NEW post and the EXISTING queue, decide what position (1-based) to insert the new post at. ` +
      `Timely/trending topics should cut to position 1-2. Evergreen content goes to the back. ` +
      `Never put two similar topics back-to-back. ` +
      `Respond with ONLY a JSON object: {"position": NUMBER, "reason": "brief reason"}\n\n` +
      `EXISTING QUEUE:\n${queueSummaryJSON}\n\n` +
      `NEW POST:\n${polished}`;

    let decidedPosition = existingQueue.length + 1;
    let queueReason = 'defaulted to end';

    try {
      const { stdout: posOut } = await runClaude(positionPrompt);
      const jsonMatch = posOut.match(/\{[\s\S]*?"position"[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.position === 'number' && parsed.position >= 1) {
          decidedPosition = Math.min(Math.max(Math.round(parsed.position), 1), existingQueue.length + 1);
          queueReason = parsed.reason || queueReason;
        }
      }
    } catch (e) {
      log(`[AUDIO] Position decision failed, defaulting to end: ${e.message}`);
    }

    log(`[AUDIO] Queue position → ${decidedPosition} (${queueReason})`);

    // 5. Build queue file content and insert
    const polishedAt = now.toISOString();
    const scheduledFor = new Date(now.getTime() + (decidedPosition - 1) * 24 * 60 * 60 * 1000).toISOString();
    const newFileContent =
      `---\n` +
      `position: ${decidedPosition}\n` +
      `date: ${dateStr}\n` +
      `source_file: raw-${mdFilename}\n` +
      `status: ready\n` +
      `polished_at: ${polishedAt}\n` +
      `queue_reason: "${queueReason.replace(/"/g, "'")}"\n` +
      `history_file: ${mdFilename}\n` +
      `---\n\n` +
      polished + '\n';

    let savedFilename;
    try {
      savedFilename = renumberQueue(existingQueue, decidedPosition, newFileContent);
    } catch (e) {
      log(`[AUDIO] Queue renumber failed: ${e.message}`);
      return;
    }

    log(`[AUDIO] Saved polished post → 2-queue/${savedFilename}`);

    // Append polished post to history file
    try {
      const historyAppend = [
        '',
        '## ✍️ Polished Post',
        '',
        polished,
        '',
        `queue_position: ${decidedPosition}`,
        `scheduled_for: ${scheduledFor}`,
        ''
      ].join('\n');
      fs.appendFileSync(historyPath, historyAppend);
      log(`[HISTORY] Appended polished post to ${mdFilename}`);
    } catch (e) {
      log(`[WARN] Could not append polished to history: ${e.message}`);
    }

    // Delete raw file from 1-processed/
    try {
      fs.unlinkSync(rawPath);
      log(`[PROCESSED] Deleted raw transcript raw-${mdFilename}`);
    } catch (e) {
      log(`[WARN] Could not delete raw transcript: ${e.message}`);
    }
  } finally {
    processingLock.delete(filePath);
  }
}

function handleAnyFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.m4a' || ext === '.wav' || ext === '.mp3') {
    handleAudioFile(filePath);
  } else if (ext === '.md') {
    handleFile(filePath);
  }
}

watcher.on('add', handleAnyFile);
watcher.on('change', handleAnyFile);

watcher.on('error', err => {
  log(`[WATCHER_ERROR] ${err.message}`);
});

watcher.on('ready', () => {
  log(`[READY] Watching ${INBOX}`);
});

log(`[START] linkedin-watcher-v2 starting`);

// --- Graceful shutdown ---
function shutdown(signal) {
  log(`[SHUTDOWN] Received ${signal}, closing watcher...`);
  watcher.close().then(() => {
    log('[SHUTDOWN] Watcher closed. Exiting.');
    process.exit(0);
  }).catch(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
