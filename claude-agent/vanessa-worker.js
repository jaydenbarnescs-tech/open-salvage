#!/usr/bin/env node
// ── Vanessa Worker ────────────────────────────────────────────────────────
// Single-consumer task processor. MAX 1 instance running at any time.
// Polls message_outbox, picks highest-priority job, runs salvage,
// posts result to Slack. Then immediately picks the next job.
//
// Safeguards:
//   - PID lockfile with stale detection (ESRCH + mtime)
//   - Orphan kill on startup (pkill prior salvage --task slack)
//   - Stalled job recovery (claimed_at > 30 min ago → reset to pending)
//   - Activity-based timeout: kill if no stream-json event or session file
//     change for STALE_MS (2 min). Absolute max of MAX_MS (30 min).
//   - Priority aging (every 5 min, bump priority by 1 up to 9)
//   - Stale message skip (> 2 hours old → expire + notify)
//   - Graceful SIGTERM handler (finish current job first)
//
// Timeout strategy (replaces old hard 300s wall):
//   salvage runs with --output-format stream-json. Every stream event
//   (tool use, API response, etc.) resets lastActivity. Claude session
//   JSONL file modifications also count as activity. If nothing moves for
//   STALE_MS → truly stuck → SIGTERM. Long but valid jobs (10-20 min) run
//   to completion without being killed.
// ─────────────────────────────────────────────────────────────────────────

"use strict";

const Database   = require("better-sqlite3");
const { WebClient } = require("@slack/web-api");
const { spawn }  = require("child_process");
const crypto     = require("crypto");
const fs         = require("fs");
const path       = require("path");

// ── Constants ──────────────────────────────────────────────────────────────
const SLACK_BOT_TOKEN  = process.env.SLACK_BOT_TOKEN || "";
const DB_PATH          = path.join(process.env.HOME, "clawd", "sessions", "agent.db");
const LOG_FILE         = path.join(process.env.HOME, "claude-agent", "logs", "worker.log");
const PID_FILE         = "/tmp/vanessa-worker.pid";
const SALVAGE        = path.join(process.env.HOME, "bin", "salvage");
const WORKSPACE        = path.join(process.env.HOME, "clawd");

const JAYDEN_DM_CHAN   = "D0AQW7VF4UA";
const JAYDEN_USER_ID   = "U0AM9DC9SJW";
const MATSUO_USER_ID   = "U09DR063A59";

const STALE_MS         = 120_000;   // kill if no stream event OR session file activity for 2 min
const MAX_MS           = 1_800_000; // absolute max per job (30 min)
const STALE_HOURS      = 2;         // messages older than this are skipped
const POLL_MS          = 2_000;     // idle poll interval
const STALL_MINUTES    = 30;        // claimed_at older than this → recover (jobs can run up to 30 min)
const MODEL_SONNET     = "claude-sonnet-4-6";
const MODEL_HAIKU      = "claude-haiku-4-5-20251001";
const MAX_TURNS        = 25;  // 50 caused session rate-limit spikes (Claude Code rolling window)

// Claude Code session files directory — watched for JSONL activity (heartbeat)
const CLAUDE_SESSIONS_DIR = path.join(process.env.HOME, ".claude", "projects", "-Users-jayden-csai-clawd");

const STALE_REPLY      = "（このメッセージへの返信が遅れました。もう一度お送りください。）";

// ── SQLite datetime parser ─────────────────────────────────────────────────
// SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC, without a 'Z'.
// new Date("2026-04-12 08:38:00") in JST interprets it as local time → 9h error.
// Force UTC by replacing the space with 'T' and appending 'Z'.
function parseSqliteUTC(s) {
  if (!s) return new Date(0);
  return new Date(s.replace(" ", "T") + "Z");
}

// ── State ──────────────────────────────────────────────────────────────────
let db;
let slack;
let stmts      = {};
let currentChild = null;
let isShuttingDown = false;

// ── Logging ────────────────────────────────────────────────────────────────
function log(level, msg, meta = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta }) + "\n";
  process.stdout.write(entry);
  // Only write to file when stdout is a TTY (i.e. manual terminal run).
  // When running under LaunchAgent, stdout is already redirected to the log file.
  if (process.stdout.isTTY) {
    try { fs.appendFileSync(LOG_FILE, entry); } catch {}
  }
}

// ── PID Lockfile ───────────────────────────────────────────────────────────
function acquireLock() {
  if (fs.existsSync(PID_FILE)) {
    let oldPid;
    try { oldPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10); } catch {}

    if (oldPid) {
      try {
        process.kill(oldPid, 0); // throws ESRCH if dead, EPERM if alive+no permission
        // Reaches here → process is alive
        log("warn", "another worker already running — exiting", { pid: oldPid });
        process.exit(0);
      } catch (e) {
        if (e.code === "EPERM") {
          // Alive but different user — treat as running
          log("warn", "worker running (EPERM) — exiting", { pid: oldPid });
          process.exit(0);
        }
        // e.code === "ESRCH" → dead process, stale file
        log("info", "stale PID file, taking over", { oldPid });
      }
    }

    // Secondary: if PID file is older than 15 min, stale regardless
    try {
      const ageMins = (Date.now() - fs.statSync(PID_FILE).mtimeMs) / 60_000;
      if (ageMins > 15) log("info", "PID file stale by mtime", { ageMins: ageMins.toFixed(1) });
    } catch {}
  }

  fs.writeFileSync(PID_FILE, String(process.pid));
  log("info", "lock acquired", { pid: process.pid });
}

function releaseLock() {
  try {
    // Only delete if it still contains our PID
    const stored = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (stored === process.pid) fs.unlinkSync(PID_FILE);
  } catch {}
}

// ── Kill orphaned salvage processes from a previous worker run ──────────
function killOrphans() {
  try {
    const { execFileSync } = require("child_process");
    execFileSync("pkill", ["-f", "salvage --task slack"], { stdio: "ignore" });
    log("info", "killed orphaned salvage processes");
  } catch {} // pkill returns exit 1 if nothing found — that's fine
}

// ── DB ─────────────────────────────────────────────────────────────────────
function openDb() {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
}

function prepareStatements() {
  // Claim one pending job atomically (BEGIN IMMEDIATE prevents lock-upgrade race)
  // ORDER BY priority DESC, created_at ASC = highest priority, then oldest first
  stmts.claimJob = db.prepare(`
    UPDATE message_outbox
    SET    status = 'processing', claimed_at = datetime('now'), worker_pid = ?
    WHERE  id = (
      SELECT id FROM message_outbox
      WHERE  status = 'pending'
        AND  (stale_after IS NULL OR stale_after > datetime('now'))
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    )
    RETURNING *
  `);

  stmts.markDone = db.prepare(`
    UPDATE message_outbox
    SET status = 'delivered', processed_at = datetime('now')
    WHERE id = ?
  `);

  // Exponential backoff: 5s → 25s → 2m → 10m → 10m (OpenClaw pattern)
  stmts.markFailed = db.prepare(`
    UPDATE message_outbox
    SET status      = 'failed',
        retry_count = retry_count + 1,
        error       = ?,
        next_retry_at = CASE
          WHEN retry_count = 0 THEN datetime('now', '+5 seconds')
          WHEN retry_count = 1 THEN datetime('now', '+25 seconds')
          WHEN retry_count = 2 THEN datetime('now', '+2 minutes')
          ELSE datetime('now', '+10 minutes')
        END
    WHERE id = ?
  `);

  stmts.markExpired = db.prepare(`
    UPDATE message_outbox SET status = 'expired' WHERE id = ?
  `);

  // Re-queue failed jobs whose backoff has elapsed
  stmts.requeueFailed = db.prepare(`
    UPDATE message_outbox
    SET    status = 'pending', claimed_at = NULL, worker_pid = NULL
    WHERE  status = 'failed'
      AND  retry_count < max_retries
      AND  next_retry_at <= datetime('now')
  `);

  // Recover stalled jobs (claimed but never finished — previous worker crash)
  stmts.recoverStalled = db.prepare(`
    UPDATE message_outbox
    SET    status     = 'pending',
           claimed_at = NULL,
           worker_pid = NULL,
           retry_count = retry_count + 1
    WHERE  status = 'processing'
      AND  claimed_at < datetime('now', '-${STALL_MINUTES} minutes')
      AND  retry_count < max_retries
  `);

  // Priority aging: every 5 min, +1 to waiting jobs (max 9, prevents starvation)
  stmts.agePriority = db.prepare(`
    UPDATE message_outbox
    SET    priority = MIN(9, priority + 1)
    WHERE  status = 'pending'
      AND  created_at < datetime('now', '-5 minutes')
      AND  priority < 9
  `);

  // Expired hisho pending_actions the dispatcher timer missed (e.g. dispatcher restart)
  stmts.getExpiredHisho = db.prepare(`
    SELECT * FROM pending_actions
    WHERE  status = 'waiting' AND expires_at <= datetime('now')
    LIMIT  5
  `);

  stmts.markHishoDone = db.prepare(`
    UPDATE pending_actions SET status = ? WHERE id = ?
  `);

  stmts.insertHishoJob = db.prepare(`
    INSERT OR IGNORE INTO message_outbox
      (id, channel, user_id, thread_ts, slack_ts, message_text,
       message_type, priority, session_key, stale_after, status)
    VALUES (?, ?, ?, ?, ?, ?, 'hisho', 9, ?, datetime('now', '+30 minutes'), 'pending')
  `);

  stmts.pendingCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM message_outbox WHERE status = 'pending'
  `);
}

// ── Model selection ────────────────────────────────────────────────────────
const COMPLEX_PATTERNS = [
  /```/,
  /\b(analyze|analyse|research|build|create|write|code|implement|explain|compare|generate|plan|strategy|design|develop|review|debug|fix|setup|configure|deploy|automate|investigate|summarize|report|translate|extract|optimize|refactor)\b/i,
];

function selectModel(text) {
  return MODEL_SONNET;
}

// ── API error patterns (checked against stream-json result text) ──────────
const API_ERROR_PATTERNS = [
  /LLM request rejected/i,
  /out of extra usage/i,
  /credit balance/i,
  /insufficient_quota/i,
  /overloaded_error/i,
  /authentication_error/i,
  /permission_error/i,
];

// ── Run salvage with activity-based timeout ─────────────────────────────
// Uses --output-format stream-json so we receive events in real-time.
// Any stream-json event or JSONL session file change resets the activity
// timer. We kill only if STALE_MS passes with NO activity (truly stuck).
// Absolute maximum is MAX_MS regardless of activity.
// Resolves as soon as we see {"type":"result","subtype":"success"} — we kill
// salvage immediately and return the text. No double-posting: the prompt
// tells Vanessa not to post via tools; the worker handles all Slack posting.
function runSalvage(prompt, sessionKey, model) {
  return new Promise((resolve, reject) => {
    const args = [
      "--workspace", WORKSPACE,
      "--task",      "slack",
      "--session-key", sessionKey,
      "--no-mcp",
      "-p", prompt,
      "--model", model,
      "--max-turns", String(MAX_TURNS),
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    const env = {
      ...process.env,
      HOME: process.env.HOME,
      PATH: `${process.env.HOME}/bin:/opt/homebrew/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    };

    const child = spawn(SALVAGE, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    currentChild = child;

    let stderr      = "";
    let stdoutBuf   = "";        // partial line buffer for stream-json parsing
    let resultText  = null;      // set when we get a successful result event
    let lastActivity = Date.now();
    let settled     = false;

    // ── Settle (resolve/reject) exactly once ─────────────────────────────
    function settle(valueOrError) {
      if (settled) return;
      settled = true;
      if (valueOrError instanceof Error) reject(valueOrError);
      else resolve(valueOrError);
    }

    // ── Kill the child (SIGTERM → SIGKILL after 5s) ───────────────────────
    function killChild() {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5_000);
    }

    // ── JSONL session directory watcher (secondary heartbeat) ─────────────
    // Any session file change (main session or sub-agents) = job is alive.
    let sessionWatcher = null;
    try {
      sessionWatcher = fs.watch(CLAUDE_SESSIONS_DIR, () => {
        lastActivity = Date.now();
      });
    } catch { /* directory may not exist yet — non-fatal */ }

    // ── Stale checker (runs every 15s) ────────────────────────────────────
    const staleChecker = setInterval(() => {
      if (settled) { clearInterval(staleChecker); return; }
      const idleMs = Date.now() - lastActivity;
      if (idleMs > STALE_MS) {
        log("warn", "salvage stale — no activity", { pid: child.pid, idleSec: Math.round(idleMs / 1000) });
        killChild();
        settle(new Error(`Salvage stale: no activity for ${STALE_MS / 1000}s`));
      }
    }, 15_000);

    // ── Absolute maximum ──────────────────────────────────────────────────
    const absoluteTimer = setTimeout(() => {
      log("warn", "salvage absolute timeout", { pid: child.pid, maxMin: MAX_MS / 60_000 });
      killChild();
      settle(new Error(`Salvage exceeded absolute max (${MAX_MS / 60_000} min)`));
    }, MAX_MS);

    // ── Parse stream-json events from stdout ──────────────────────────────
    child.stdout.on("data", chunk => {
      lastActivity = Date.now();
      stdoutBuf += chunk.toString();

      // Process complete newline-delimited JSON lines
      let newline;
      while ((newline = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, newline).trim();
        stdoutBuf  = stdoutBuf.slice(newline + 1);
        if (!line) continue;

        try {
          const event = JSON.parse(line);

          if (event.type === "result") {
            const text = typeof event.result === "string" ? event.result : "";

            if (event.subtype === "success") {
              // Check for API errors embedded in the result text
              for (const pat of API_ERROR_PATTERNS) {
                if (pat.test(text)) {
                  killChild();
                  settle(new Error(`API error (exit 0): ${text.slice(0, 200)}`));
                  return;
                }
              }
              resultText = text;
              // Layer 1 fix: do NOT kill the child process here.
              // Salvage calls updateSessionState() at the end of its own main().
              // If we kill it now, updateSessionState never runs, state.json never
              // updates, and --continue is never passed on the next invocation.
              // Instead: resolve immediately so Slack posting can begin, but let
              // salvage exit naturally. The staleChecker / absoluteTimer will
              // kill it if it somehow hangs after this point.
              settle(text);
            } else {
              // error_max_turns, error_during_execution, etc.
              // If Claude managed to write partial text, surface it rather than failing.
              if (text && text.trim()) {
                resultText = text;
                // For error subtypes we still want to let salvage clean up
                // naturally, but we do kill to avoid lingering on broken state.
                killChild();
                settle(text);
              } else {
                killChild();
                settle(new Error(`Salvage result error: ${event.subtype}`));
              }
            }
          }
        } catch {
          // Non-JSON line (salvage startup logs, etc.) — ignore
        }
      }
    });

    child.stderr.on("data", d => {
      lastActivity = Date.now(); // stderr activity also counts as alive
      stderr += d;
    });

    // ── Cleanup on process exit ───────────────────────────────────────────
    child.on("close", code => {
      clearInterval(staleChecker);
      clearTimeout(absoluteTimer);
      if (sessionWatcher) { try { sessionWatcher.close(); } catch {} }
      currentChild = null;

      if (settled) return; // already resolved/rejected (e.g. via result event)

      // Process exited before we saw a result event
      if (resultText !== null) {
        settle(resultText); // safety net
      } else if (code !== 0) {
        settle(new Error(`Salvage exited code ${code}: ${(stderr || "").slice(0, 300)}`));
      } else {
        settle(new Error("Salvage exited without producing a result"));
      }
    });

    child.on("error", err => {
      clearInterval(staleChecker);
      clearTimeout(absoluteTimer);
      if (sessionWatcher) { try { sessionWatcher.close(); } catch {} }
      currentChild = null;
      settle(err);
    });
  });
}

// ── Slack helpers ─────────────────────────────────────────────────────────
async function addReaction(channel, ts, emoji) {
  try { await slack.reactions.add({ channel, timestamp: ts, name: emoji }); } catch {}
}

async function removeReaction(channel, ts, emoji) {
  try { await slack.reactions.remove({ channel, timestamp: ts, name: emoji }); } catch {}
}

function chunkMessage(text, limit = 3900) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}

// ── Fetch recent Slack history for context ────────────────────────────────
// Layer 4: expanded limits — 20 messages, 1000 chars per message
async function fetchHistory(channel, currentTs, threadTs, limit = 20) {
  try {
    let msgs = [];
    if (threadTs && threadTs !== currentTs) {
      // Inside a thread — fetch the thread replies for full context
      const res = await slack.conversations.replies({ channel, ts: threadTs, limit: limit + 1 });
      msgs = (res.messages || []).filter(m => m.ts !== currentTs).slice(-limit);
    } else {
      // Top-level DM or channel — fetch recent channel history
      const res = await slack.conversations.history({ channel, limit: limit + 1 });
      msgs = (res.messages || []).filter(m => m.ts !== currentTs).slice(0, limit).reverse();
    }
    if (!msgs.length) return "";
    const lines = msgs.map(m => {
      const who  = m.bot_id ? "Vanessa (you)" : `<@${m.user}>`;
      const text = (m.text || "").replace(/\n+/g, " ").slice(0, 1000);
      return `  ${who}: ${text}`;
    }).join("\n");
    return `[Recent conversation — last ${msgs.length} messages]\n${lines}\n[End history]\n\n`;
  } catch {
    return ""; // non-fatal — Vanessa just won't have history context
  }
}

// ── Memory enforcement helpers ────────────────────────────────────────────
const SENTINEL_PATH   = path.join(process.env.HOME, "clawd", "sessions", "last-memory-write.ts");
const AUTO_NOTE_PATH  = path.join(process.env.HOME, "clawd", "sessions", "pending-auto-note.txt");
const MEMORY_UPDATE_BIN = path.join(process.env.HOME, "bin", "vanessa-memory-update");

// Returns true if text looks like a behavioral directive.
// False positives are acceptable — writing to memory twice is harmless.
// False negatives are the problem we're guarding against.
function isStandingInstruction(text) {
  if (!text || typeof text !== "string") return false;
  if (text.length > 300) return false;

  // Not a question
  if (/[？?]\s*$/.test(text.trim())) return false;

  // Japanese behavioral directive patterns
  const jpPatterns = /使うな|やめて|にして|からは|ルールとして|覚えて|してください/;
  // English behavioral directive patterns
  const enPatterns = /\bdon'?t\b|\balways\b|\bfrom now on\b|\bstop doing\b|\bmake sure you\b|\bnever\b/i;
  // Looser English "use X" patterns (e.g. "use English", "use this format")
  const enUse = /\buse\b/i;

  return jpPatterns.test(text) || enPatterns.test(text) || enUse.test(text);
}

// Runs AFTER Slack response is posted. Checks whether Vanessa called
// vanessa-memory-update herself this turn; if not, enforces it.
function enforceMemoryWrite(messageText, turnStartTime) {
  try {
    // Step 1: Is this a standing instruction?
    if (!isStandingInstruction(messageText)) return;

    // Step 2: Did Vanessa call the tool herself this turn?
    try {
      const raw = fs.readFileSync(SENTINEL_PATH, "utf-8").trim();
      const sentinelTs = parseInt(raw, 10);
      if (!isNaN(sentinelTs) && sentinelTs > turnStartTime) {
        // Vanessa called it — no enforcement needed
        log("info", "memory-enforce: Vanessa wrote memory herself this turn", { sentinelTs });
        return;
      }
    } catch {
      // File doesn't exist or unreadable — treat as not called
    }

    // Step 3: Vanessa skipped it — enforce from the worker
    log("warn", "memory-enforce: Vanessa did NOT call vanessa-memory-update — enforcing", {
      text: messageText.slice(0, 100),
    });

    const truncated = messageText.slice(0, 500);

    // Spawn vanessa-memory-update as a child process
    const env = {
      ...process.env,
      HOME: process.env.HOME,
      PATH: `${process.env.HOME}/bin:/opt/homebrew/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    };
    const child = spawn(MEMORY_UPDATE_BIN, ["instruction", truncated], {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let childOut = "";
    let childErr = "";
    child.stdout.on("data", d => { childOut += d; });
    child.stderr.on("data", d => { childErr += d; });
    child.on("close", code => {
      if (code !== 0) {
        log("error", "memory-enforce: vanessa-memory-update failed", {
          code,
          stderr: childErr.slice(0, 300),
        });
        return;
      }
      log("info", "memory-enforce: vanessa-memory-update succeeded", {
        stdout: childOut.trim().slice(0, 200),
      });

      // Step 3b: Insert DB row with auto_recorded = true
      try {
        const CLAUDE_AGENT_DIR = path.join(process.env.HOME, "claude-agent");
        const dbModulePath = path.join(CLAUDE_AGENT_DIR, "node_modules", "better-sqlite3");
        const Database = require(dbModulePath);
        const autoDb = new Database(DB_PATH);
        autoDb.pragma("journal_mode = WAL");
        // Ensure column exists
        try { autoDb.exec(`ALTER TABLE vanessa_memory ADD COLUMN auto_recorded INTEGER DEFAULT 0`); } catch {}
        const stmt = autoDb.prepare(
          `INSERT INTO vanessa_memory (category, content, auto_recorded) VALUES ('instruction', ?, 1)`
        );
        const result = stmt.run(truncated);
        autoDb.close();
        log("info", "memory-enforce: DB row inserted with auto_recorded=1", { rowId: result.lastInsertRowid });
      } catch (dbErr) {
        log("error", "memory-enforce: DB insert failed", { error: dbErr.message });
      }

      // Step 4: Write pending auto-note for next turn
      try {
        const note = `[自動記録] 前のターンでメモリへの記録が行われなかったため、ワーカーが自動で記録しました: "${truncated}"`;
        fs.writeFileSync(AUTO_NOTE_PATH, note, "utf-8");
        log("info", "memory-enforce: pending auto-note written");
      } catch (noteErr) {
        log("error", "memory-enforce: failed to write auto-note", { error: noteErr.message });
      }
    });
    child.on("error", err => {
      log("error", "memory-enforce: failed to spawn vanessa-memory-update", { error: err.message });
    });

  } catch (err) {
    log("error", "memory-enforce: unexpected error", { error: err.message });
  }
}

// ── Process one job ────────────────────────────────────────────────────────
async function processJob(job) {
  const {
    id, channel, user_id, thread_ts, slack_ts,
    message_text, message_type, session_key,
    retry_count, max_retries,
  } = job;

  const reactionTs = slack_ts && !slack_ts.startsWith("hisho:") && !slack_ts.startsWith("slash:")
    ? slack_ts
    : thread_ts;
  const threadTs   = thread_ts || slack_ts;
  const sessionKey = session_key || `claw:slack:${channel}:${user_id}`;
  const model      = selectModel(message_text);
  const turnStartTime = Date.now(); // used by enforceMemoryWrite to detect sentinel freshness

  log("info", "processing", { id, channel, user_id, message_type, priority: job.priority, model, retry: retry_count });

  if (reactionTs) await addReaction(channel, reactionTs, "eyes");

  // Fetch conversation history so Vanessa has context of what came before
  const history = message_type !== "hisho"
    ? await fetchHistory(channel, reactionTs, thread_ts)
    : "";

  // Layer 2: Inject core memory — always prepend to every prompt.
  // This is Vanessa's persistent brain that survives session resets and process kills.
  // Inspired by Letta/MemGPT's Core Memory pattern: a small structured block
  // injected at the top of every prompt, separate from conversation history.
  //
  // Primary source: Mem0 (all.py) — semantic vector store, auto-deduplicates & resolves conflicts.
  // Fallback: vanessa-core-memory.md — raw markdown file (original Layer 2 source).
  let coreMemory = "";
  try {
    const { execSync } = require("child_process");
    const ALL_PY    = path.join(process.env.HOME, "claude-agent", "mem0", "all.py");
    const VENV_PY   = path.join(process.env.HOME, "claude-agent", "mem0-env", "bin", "python");
    const raw = execSync(`${VENV_PY} ${ALL_PY}`, {
      timeout: 30_000,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: process.env.HOME,
        PATH: `${process.env.HOME}/bin:/opt/homebrew/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      },
    }).trim();
    if (raw) {
      coreMemory = `[CORE MEMORY — read this first, it persists across sessions]\n${raw}\n[END CORE MEMORY]\n\n`;
      log("info", "core-memory: loaded from Mem0 (all.py)");
    }
  } catch (mem0Err) {
    // Fallback: read vanessa-core-memory.md directly
    log("warn", "core-memory: Mem0 all.py failed, falling back to .md file", { error: mem0Err.message?.slice(0, 100) });
    try {
      const coreMemPath = path.join(WORKSPACE, "vanessa-core-memory.md");
      const raw = fs.readFileSync(coreMemPath, "utf-8").trim();
      if (raw) {
        coreMemory = `[CORE MEMORY — read this first, it persists across sessions]\n${raw}\n[END CORE MEMORY]\n\n`;
        log("info", "core-memory: loaded from fallback .md file");
      }
    } catch { /* non-fatal — if both sources fail, Vanessa just starts fresh */ }
  }

  // Layer 5: Inject pending auto-note from previous turn's enforcement (if any).
  // Written by enforceMemoryWrite() when Vanessa skipped the memory tool.
  // Prepended to context so she knows the worker recorded on her behalf.
  let autoNote = "";
  try {
    if (fs.existsSync(AUTO_NOTE_PATH)) {
      const noteText = fs.readFileSync(AUTO_NOTE_PATH, "utf-8").trim();
      if (noteText) {
        autoNote = `[SYSTEM NOTE — from previous turn]\n${noteText}\n[END SYSTEM NOTE]\n\n`;
        log("info", "memory-enforce: injecting auto-note into prompt and deleting file");
      }
      fs.unlinkSync(AUTO_NOTE_PATH); // consume it — only shows once
    }
  } catch (noteReadErr) {
    log("warn", "memory-enforce: could not read/delete auto-note", { error: noteReadErr.message });
  }

  // WORKER_MODE: prevent Vanessa from posting to Slack via tools/sub-agents.
  // The worker handles all Slack posting — Vanessa just needs to output text.
  // Without this, she spawns sub-agents that post directly, causing duplicates
  // when the worker also posts her stdout response.
  //
  // Layer 2 update: explicitly allow the vanessa-memory-update and
  // vanessa-memory-read bash tools so she can persist standing instructions.
  const WORKER_MODE =
    "[WORKER_MODE] You are running inside vanessa-worker. " +
    "Do NOT post messages to Slack or DM via tools or sub-agents. " +
    "Write your complete response as plain text — the worker will post it to Slack for you. " +
    "You MAY use bash tools to: read files, run vanessa-memory-read, run vanessa-memory-update, " +
    "search memory (salvage-memory-search), read Slack history, query the DB. " +
    "You may NOT use salvage-tools to send Slack messages. " +
    "Layer 3 rule: Execute ALL required tool calls (memory writes, reads, actions) FIRST. " +
    "Only after all actions are complete, write your final plain-text response summarizing what was done. " +
    "Do not write a response before running tools — act first, then speak.\n\n";

  let prompt;
  if (message_type === "hisho") {
    prompt = coreMemory + autoNote + WORKER_MODE + [
      `[秘書モード: 松尾さんが10分前に <#${channel}> にメッセージを送りました。Jaydenが返信していません。]`,
      `[元メッセージ: ${message_text}]`,
      `日本語で丁寧に返信してください。Jaydenの代わりに返信していることを必ず示してください。`,
    ].join("\n");
  } else {
    prompt = `${coreMemory}${autoNote}${WORKER_MODE}${history}[Slack ${message_type} from <@${user_id}> in <#${channel}>]\n${message_text}`;
  }

  try {
    const response = await runSalvage(prompt, sessionKey, model);

    // 👀 → ✅
    if (reactionTs) {
      await removeReaction(channel, reactionTs, "eyes");
      await addReaction(channel, reactionTs, "white_check_mark");
    }

    const chunks = chunkMessage(response);
    for (const chunk of chunks) {
      const text = message_type === "hisho"
        ? chunk + "\n\n_※ AIアシスタント（Vanessa）による代理返信です。Jaydenが確認次第、補足・訂正する場合があります。_"
        : chunk;
      await slack.chat.postMessage({ channel, thread_ts: threadTs, text });
    }

    stmts.markDone.run(id);

    if (reactionTs) {
      setTimeout(() => removeReaction(channel, reactionTs, "white_check_mark"), 5_000);
    }

    log("info", "job done", { id, chunks: chunks.length, len: response.length, model });

    // Layer 5: Post-turn memory enforcement — runs fully async after response is posted.
    // If Vanessa was supposed to call vanessa-memory-update but didn't, the worker does it.
    // Non-blocking: setImmediate ensures this never delays the next job from being picked up.
    if (message_type !== "hisho") {
      setImmediate(() => enforceMemoryWrite(message_text, turnStartTime));
    }

  } catch (err) {
    // 👀 → ❌
    if (reactionTs) {
      await removeReaction(channel, reactionTs, "eyes");
      await addReaction(channel, reactionTs, "x");
    }

    const errMsg = err.message?.slice(0, 200);

    if ((retry_count || 0) < (max_retries || 3) - 1) {
      stmts.markFailed.run(errMsg, id);
      log("warn", "job failed, scheduled retry", { id, error: errMsg, attempt: (retry_count || 0) + 1 });
    } else {
      stmts.markFailed.run(errMsg, id);
      // All retries exhausted — tell the user
      let userMsg = "エラーが発生しました。もう一度お試しください。";
      if (err.message?.includes("stale") || err.message?.includes("absolute max"))
                                                        userMsg = "処理がタイムアウトしました（応答なし）。もう一度お試しください。";
      if (err.message?.includes("rate limit"))         userMsg = "APIレート制限に達しました。少し待ってから再度お試しください。";
      if (err.message?.includes("out of extra usage") ||
          err.message?.includes("LLM request rejected") ||
          err.message?.includes("credit balance"))     userMsg = "⚠️ APIの使用上限に達しました。claude.ai/settings/usage でクレジットを追加してください。";
      try {
        await slack.chat.postMessage({ channel, thread_ts: threadTs, text: `:warning: ${userMsg}` });
      } catch {}
      log("error", "job permanently failed", { id, error: errMsg });
    }
  }
}

// ── Handle expired pending_actions (hisho timers missed by dispatcher) ────
async function processExpiredHisho() {
  const expired = stmts.getExpiredHisho.all();
  for (const action of expired) {
    const text = action.message_text || "";
    // Confidence classification
    const isHigh = /いつ|何時|日時|予定|ステータス|進捗|状況|どこ|リンク|URL|ファイル|完了|済み/.test(text);
    const isLow  = /どう思|意見|戦略|方針|判断|決め|考え|相談/.test(text);
    const confidence = isHigh ? "high" : isLow ? "low" : "medium";

    if (confidence === "low") {
      // DM Jayden — don't auto-reply
      try {
        await slack.chat.postMessage({
          channel: JAYDEN_DM_CHAN,
          text: `📩 松尾さんから <#${action.channel}> にメッセージです\n\n内容: ${text.slice(0, 300)}\n\n返信する場合はチャンネルで直接お願いします。`,
        });
        stmts.markHishoDone.run("notified", action.id);
        log("info", "hisho: notified Jayden (low confidence)", { actionId: action.id });
      } catch (e) {
        log("error", "hisho: DM failed", { error: e.message });
      }
    } else {
      // Insert as high-priority auto-reply job
      const jobId = crypto.randomUUID();
      stmts.insertHishoJob.run(
        jobId, action.channel, action.trigger_user,
        action.thread_ts, `hisho:${action.thread_ts}`,
        text, `claw:hisho:${action.channel}:${action.thread_ts}`
      );
      stmts.markHishoDone.run("queued", action.id);
      log("info", "hisho: queued auto-reply job", { jobId, confidence });
    }
  }
}

// ── Maintenance (stall recovery, failed requeue, aging) ───────────────────
function runMaintenance() {
  const stalled = stmts.recoverStalled.run();
  if (stalled.changes > 0) log("info", "recovered stalled jobs", { count: stalled.changes });

  const requeued = stmts.requeueFailed.run();
  if (requeued.changes > 0) log("info", "requeued failed jobs", { count: requeued.changes });
}

// ── Main worker loop ───────────────────────────────────────────────────────
async function workerLoop() {
  if (isShuttingDown) return;

  try {
    runMaintenance();
    await processExpiredHisho();

    // Claim next job atomically with BEGIN IMMEDIATE (prevents lock-upgrade race)
    const claimTxn = db.transaction(() => stmts.claimJob.get(process.pid));
    const job = claimTxn();

    if (!job) {
      // Queue empty — wait before next poll
      setTimeout(workerLoop, POLL_MS);
      return;
    }

    // Check if message is too stale to be worth processing
    // parseSqliteUTC: forces UTC interpretation of SQLite's "YYYY-MM-DD HH:MM:SS" string
    const ageHours = (Date.now() - parseSqliteUTC(job.created_at).getTime()) / 3_600_000;
    if (ageHours > STALE_HOURS) {
      log("info", "skipping stale message", { id: job.id, ageHours: ageHours.toFixed(1) });
      stmts.markExpired.run(job.id);
      try {
        if (job.thread_ts) {
          await slack.chat.postMessage({ channel: job.channel, thread_ts: job.thread_ts, text: STALE_REPLY });
        }
      } catch {}
      // Don't delay — check for next job immediately
      setImmediate(workerLoop);
      return;
    }

    await processJob(job);

  } catch (err) {
    log("error", "worker loop error", { error: err.message });
  }

  // Immediately check for the next job (no delay between jobs)
  if (!isShuttingDown) setImmediate(workerLoop);
}

// ── Priority aging interval ────────────────────────────────────────────────
function startAgingInterval() {
  setInterval(() => {
    const result = stmts.agePriority.run();
    if (result.changes > 0) {
      log("info", "priority aging", { boosted: result.changes });
    }
  }, 5 * 60_000);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

  acquireLock();

  // Graceful shutdown: finish current job then exit
  process.on("SIGTERM", () => {
    log("info", "SIGTERM — finishing current job then exiting");
    isShuttingDown = true;
    if (currentChild) {
      currentChild.kill("SIGTERM");
      setTimeout(() => { try { currentChild?.kill("SIGKILL"); } catch {} }, 5_000);
    }
    setTimeout(() => { releaseLock(); process.exit(0); }, 7_000);
  });

  process.on("SIGINT",  () => { isShuttingDown = true; releaseLock(); process.exit(0); });
  process.on("exit",    releaseLock);
  process.on("uncaughtException", err => {
    log("error", "uncaughtException", { error: err.message, stack: err.stack?.slice(0, 300) });
    // Don't exit — keep processing
  });
  process.on("unhandledRejection", (reason) => {
    log("error", "unhandledRejection", { reason: String(reason).slice(0, 200) });
  });

  openDb();
  prepareStatements();

  // Startup recovery
  const stalled = stmts.recoverStalled.run();
  if (stalled.changes > 0) log("info", "startup: recovered stalled jobs", { count: stalled.changes });

  killOrphans();

  slack = new WebClient(SLACK_BOT_TOKEN);
  startAgingInterval();

  const pending = stmts.pendingCount.get().cnt;
  log("info", "worker started", { pid: process.pid, pendingJobs: pending });

  workerLoop();
}

main().catch(e => {
  log("error", "fatal crash", { error: e.message, stack: e.stack?.slice(0, 500) });
  releaseLock();
  process.exit(1);
});
