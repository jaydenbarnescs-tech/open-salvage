#!/usr/bin/env node
// ── Slack Bridge via Mechatron ─────────────────────────────────────────
// Listens on Slack Socket Mode, pipes messages through mechatron wrapper,
// and posts responses back. All context assembly handled by mechatron.
// ────────────────────────────────────────────────────────────────────────

const { App } = require("@slack/bolt");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Database helper with better-sqlite3 (proper async support) ──────────
const DB_CMD = path.join(process.env.HOME, "bin", "mechatron-db");
let db = null;

// Lazy-load database connection
function getDb() {
  if (!db) {
    try {
      const Database = require("better-sqlite3");
      const dbPath = path.join(process.env.HOME, "clawd", "sessions", "agent.db");
      db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
    } catch (e) {
      log("warn", "better-sqlite3 not available, falling back to mechatron-db CLI", { error: e.message });
      return null;
    }
  }
  return db;
}

// Primary: use better-sqlite3 if available, fallback to CLI
function dbExecWithParams(query, params = []) {
  const database = getDb();
  if (database) {
    try {
      const stmt = database.prepare(query);
      if (query.trim().toLowerCase().startsWith("select")) {
        return stmt.all(...params);
      } else {
        return stmt.run(...params);
      }
    } catch (e) {
      log("warn", "db operation failed", { error: e.message?.slice(0, 100) });
      return null;
    }
  }
  // Fallback to CLI (for backward compatibility)
  return dbExecLegacy(...params);
}

function dbExecLegacy(...args) {
  try {
    const { execFileSync } = require("child_process");
    return execFileSync(DB_CMD, args, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch (e) {
    log("warn", "db operation failed", { args: args.slice(0, 3), error: e.message?.slice(0, 100) });
    return null;
  }
}

function dbSaveMessage(channel, userId, text, threadTs) {
  return dbExecWithParams(
    "INSERT INTO messages (channel, user_id, text, thread_ts, created_at) VALUES (?, ?, ?, ?, datetime('now')) RETURNING id",
    [channel, userId, text, threadTs || null]
  );
}

function dbMessageDone(msgId) {
  return dbExecWithParams(
    "UPDATE messages SET status = 'done', updated_at = datetime('now') WHERE id = ?",
    [msgId]
  );
}

function dbMessageFail(msgId, error) {
  return dbExecWithParams(
    "UPDATE messages SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?",
    [error || "unknown", msgId]
  );
}

function dbGetPendingMessages() {
  try {
    const result = dbExecWithParams(
      "SELECT * FROM messages WHERE status = 'pending' ORDER BY created_at DESC LIMIT 10",
      []
    );
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

// ── 秘書 Mode Functions ──────────────────────────────────────────────────

function savePendingAction(channel, threadTs, messageText) {
  const id = require("crypto").randomUUID();
  const expiresAt = new Date(Date.now() + HISHO_DELAY_MS).toISOString();
  try {
    return dbExecWithParams(
      "INSERT INTO pending_actions (id, type, channel, thread_ts, trigger_user, target_user, message_text, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, "matsuo_reply", channel, threadTs || null, MATSUO_USER_ID, JAYDEN_USER_ID, messageText, "waiting", expiresAt]
    );
  } catch {}
  return id;
}

function cancelPendingAction(channel, threadTs, reason) {
  try {
    const threadMatch = threadTs ? ["AND thread_ts = ?", threadTs] : ["", null];
    return dbExecWithParams(
      `UPDATE pending_actions SET status = 'cancelled', cancelled_reason = ? WHERE channel = ? ${threadMatch[0]} AND status = 'waiting'`,
      [reason, channel, threadMatch[1]].filter(x => x !== null)
    );
  } catch {}
}

function getExpiredPendingActions() {
  try {
    const result = dbExecWithParams(
      "SELECT * FROM pending_actions WHERE status = 'waiting' AND expires_at < datetime('now') LIMIT 3",
      []
    );
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

function markPendingActionDone(id, status) {
  try {
    return dbExecWithParams(
      "UPDATE pending_actions SET status = ? WHERE id = ?",
      [status, id]
    );
  } catch {}
}

function classifyConfidence(text) {
  const lower = (text || "").toLowerCase();
  // High confidence: factual, status, scheduling
  const highPatterns = /いつ|何時|日時|予定|ステータス|進捗|状況|どこ|リンク|URL|ファイル|ドキュメント|完了|済み|schedule|when|status|link|file|document|done/;
  if (highPatterns.test(lower)) return "high";
  // Low confidence: vague, personal
  const lowPatterns = /お疲れ|どう思|意見|戦略|方針|判断|決め|考え|相談|think|opinion|decide|strategy/;
  if (lowPatterns.test(lower)) return "low";
  // Medium: everything else
  return "medium";
}

// ── Config ──────────────────────────────────────────────────────────────
const SLACK_BOT_TOKEN =
  process.env.SLACK_BOT_TOKEN || "";
const SLACK_APP_TOKEN =
  process.env.SLACK_APP_TOKEN || "";

const MECHATRON = path.join(process.env.HOME, "bin", "mechatron");
const WORKSPACE = path.join(process.env.HOME, "clawd");
const LOG_DIR = path.join(process.env.HOME, "claude-agent", "logs");
const LOG_FILE = path.join(LOG_DIR, "bridge.log");

const MODEL_SONNET = "claude-sonnet-4-6";
const MODEL_HAIKU  = "claude-haiku-4-5-20251001";
const MAX_TURNS = 50;

// ── Process Pool for mechatron spawns (prevent resource exhaustion) ──────
const MAX_CONCURRENT_SPAWNS = 3;
let activeSpawns = 0;
const spawnQueue = [];

async function spawnWithPool(args, env) {
  return new Promise((resolve, reject) => {
    const trySpawn = () => {
      if (activeSpawns >= MAX_CONCURRENT_SPAWNS) {
        spawnQueue.push(trySpawn);
        return;
      }
      activeSpawns++;

      const child = spawn(MECHATRON, args, { stdio: ["ignore", "pipe", "pipe"], env });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      child.on("close", (code) => {
        activeSpawns--;
        const next = spawnQueue.shift();
        if (next) next();

        if (code !== 0) {
          reject(new Error(`Mechatron exited with code ${code}: ${(stderr || stdout || "").slice(0, 300)}`));
        } else {
          resolve({ stdout: stdout.trim(), stderr });
        }
      });

      child.on("error", (err) => {
        activeSpawns--;
        const next = spawnQueue.shift();
        if (next) next();
        reject(err);
      });
    };

    trySpawn();
  });
}

// ── 秘書 Mode: 松尾さん monitoring ───────────────────────────────────────
const MATSUO_USER_ID = "U09DR063A59";
const JAYDEN_USER_ID = "U0AM9DC9SJW";
const JAYDEN_DM_CHANNEL = "D0AQW7VF4UA";
const HISHO_DELAY_MS = 10 * 60 * 1000; // 10 minutes before acting
const HISHO_MAX_AUTO_REPLIES_PER_THREAD = 2;
const hishoTimers = new Map(); // channelThread → timer
const hishoAutoReplyCount = new Map(); // channelThread → count

// ── Complexity-based model selection ────────────────────────────────────
// Default to Haiku for cost efficiency; only use Sonnet for complex tasks
const COMPLEX_PATTERNS = [
  /```/,                        // code blocks
  /\b(analyze|analyse|research|build|create|write|code|implement|explain|compare|generate|plan|strategy|design|develop|review|debug|fix|setup|configure|deploy|automate|investigate|summarize|report|translate|extract|optimize|refactor|find|search|look into|take a look|help me|can you|could you|what is|how do|why does|show me)\b/i,
];

function selectModel(text) {
  // Default to Haiku for speed and cost
  if (text.length > 200) return MODEL_SONNET;        // long messages → Sonnet
  for (const p of COMPLEX_PATTERNS) {
    if (p.test(text)) return MODEL_SONNET;
  }
  return MODEL_HAIKU;                                // short/simple → Haiku (NEW DEFAULT)
}

const TIMEOUT_MS = 300_000; // 5 minutes per request (MCP servers need startup time)

// Bot's own user ID — filled on startup to filter self-messages
let BOT_USER_ID = null;

// ── Pending message queue (survives crashes) ────────────────────────────
const PENDING_QUEUE_PATH = path.join(process.env.HOME, "clawd", "sessions", "pending-messages.json");

function loadPendingQueue() {
  try { return JSON.parse(fs.readFileSync(PENDING_QUEUE_PATH, "utf-8")); }
  catch { return []; }
}

function savePendingQueue(queue) {
  fs.mkdirSync(path.dirname(PENDING_QUEUE_PATH), { recursive: true });
  fs.writeFileSync(PENDING_QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function addToPendingQueue(message) {
  const queue = loadPendingQueue();
  // Prevent duplicates
  if (queue.find(m => m.ts === message.ts && m.channel === message.channel)) return;
  queue.push({
    ts: message.ts,
    channel: message.channel,
    user: message.user,
    text: (message.text || "").slice(0, 500),
    thread_ts: message.thread_ts,
    addedAt: new Date().toISOString(),
    status: "pending",
  });
  // Keep max 20 pending messages
  while (queue.length > 20) queue.shift();
  savePendingQueue(queue);
}

function markPendingDone(ts, channel) {
  const queue = loadPendingQueue();
  const updated = queue.filter(m => !(m.ts === ts && m.channel === channel));
  savePendingQueue(updated);
}

function getPendingMessages() {
  return loadPendingQueue().filter(m => m.status === "pending");
}

// ── Deduplication cache (OpenClaw pattern) ──────────────────────────────
const DEDUP_TTL_MS = 60_000;  // 60 second TTL
const DEDUP_MAX_SIZE = 500;
const dedupCache = new Map();  // key → timestamp

function isDuplicate(key) {
  const now = Date.now();
  // Prune expired entries periodically
  if (dedupCache.size > DEDUP_MAX_SIZE) {
    for (const [k, ts] of dedupCache) {
      if (now - ts > DEDUP_TTL_MS) dedupCache.delete(k);
    }
  }
  if (dedupCache.has(key) && now - dedupCache.get(key) < DEDUP_TTL_MS) {
    return true;
  }
  dedupCache.set(key, now);
  return false;
}

function buildDedupeKey(message) {
  return `${message.channel}:${message.ts}:${message.user || 'unknown'}`;
}

// ── Logging ─────────────────────────────────────────────────────────────
function log(level, msg, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };
  const line = JSON.stringify(entry) + "\n";
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {
    // best-effort
  }
}

// ── Derive session key (OpenClaw pattern) ───────────────────────────────
function buildSessionKey(channelId, userId, threadTs) {
  // DMs: all messages (including threads) share one session per user
  // This prevents each thread from starting a fresh session and wasting turns
  // Channel messages: per-channel session
  return `claw:slack:${channelId}:${userId}`;
}

// ── Fetch recent conversation history from Slack ────────────────────────
async function fetchRecentHistory(client, channelId, currentTs, threadTs, limit = 6) {
  try {
    let msgs = [];

    if (threadTs && threadTs !== currentTs) {
      // Thread reply — fetch thread replies for full context
      const result = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: limit + 1,
      });
      if (result.messages) {
        msgs = result.messages
          .filter(m => m.ts !== currentTs)
          .slice(-limit); // most recent N from thread
      }
    } else {
      // Channel message — fetch channel history
      const result = await client.conversations.history({
        channel: channelId,
        limit: limit + 1,
      });
      if (result.messages) {
        msgs = result.messages
          .filter(m => m.ts !== currentTs)
          .slice(0, limit)
          .reverse();
      }
    }

    if (msgs.length === 0) return '';

    const lines = msgs.map(m => {
      const who = m.bot_id ? 'Vanessa (you)' : `<@${m.user}>`;
      const text = (m.text || '').replace(/\n+/g, ' ').slice(0, 400);
      return `  ${who}: ${text}`;
    }).join('\n');

    const context = threadTs ? 'thread' : 'conversation';
    return `[Recent ${context} — last ${msgs.length} messages]\n${lines}\n[End history]\n\n`;
  } catch (e) {
    return ''; // non-fatal
  }
}

// ── Status reactions (OpenClaw pattern: 👀 → ✅/❌) ────────────────────
async function addReaction(client, channel, ts, emoji) {
  try {
    await client.reactions.add({ channel, timestamp: ts, name: emoji });
  } catch (_) { /* may lack permission or already reacted */ }
}

async function removeReaction(client, channel, ts, emoji) {
  try {
    await client.reactions.remove({ channel, timestamp: ts, name: emoji });
  } catch (_) {}
}

// ── Call mechatron (with optional streaming callback) ────────────────────
async function callMechatron(prompt, sessionKey, onChunk, model) {
  // Use provided model or select based on prompt
  const chosenModel = model || selectModel(prompt);

  const args = [
    "--workspace", WORKSPACE,
    "--task", "slack",
    "--session-key", sessionKey,
    "--no-mcp",
    "-p", prompt,
    "--model", chosenModel,
    "--max-turns", String(MAX_TURNS),
    "--output-format", "text",
    "--dangerously-skip-permissions",
  ];

  log("info", "calling mechatron", {
    workspace: WORKSPACE,
    session: sessionKey,
    model: chosenModel,
    promptLen: prompt.length,
    streaming: !!onChunk,
  });

  const env = {
    ...process.env,
    HOME: process.env.HOME,
    PATH: `${process.env.HOME}/bin:/opt/homebrew/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Mechatron timed out after " + TIMEOUT_MS / 1000 + "s"));
    }, TIMEOUT_MS);

    spawnWithPool(args, env)
      .then(({ stdout, stderr }) => {
        clearTimeout(timer);
        if (onChunk) {
          try { onChunk(stdout); } catch {}
        }
        log("info", "mechatron responded", { len: stdout.length });
        resolve(stdout);
      })
      .catch((err) => {
        clearTimeout(timer);
        log("error", "mechatron failed", {
          error: err.message?.slice(0, 500),
        });
        reject(err);
      });
  });
}

// ── Chunk long messages for Slack (limit ~3900 chars for safety) ───────
function chunkMessage(text, limit = 3900) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf("\n", limit);
    if (breakAt < limit * 0.5) breakAt = limit;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  return chunks;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  log("info", "starting slack bridge", { workspace: WORKSPACE });

  const app = new App({
    token: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    socketMode: true,
  });

  // Get bot's own user ID
  try {
    const authResult = await app.client.auth.test({ token: SLACK_BOT_TOKEN });
    BOT_USER_ID = authResult.user_id;
    log("info", "authenticated", { botUserId: BOT_USER_ID, team: authResult.team });
  } catch (e) {
    log("error", "auth.test failed", { error: e.message });
  }

  // ── Handle regular messages (DMs + channels) ────────────────────────
  app.message(async ({ message, say, client }) => {
    if (message.bot_id || message.subtype === "bot_message") return;
    if (message.subtype) return;
    if (!message.text || !message.text.trim()) return;

    const dedupeKey = buildDedupeKey(message);
    if (isDuplicate(dedupeKey)) return;

    const userText = message.text.trim();
    const channelId = message.channel;
    const threadTs = message.thread_ts || message.ts;
    const userId = message.user;
    const isDM = channelId.startsWith("D");

    // ── 秘書 Mode: Jayden reply cancels pending actions ──────────────
    if (userId === JAYDEN_USER_ID && !isDM) {
      cancelPendingAction(channelId, message.thread_ts, "jayden_replied");
    }

    // ── 秘書 Mode: 松尾さん mentions @バーンズ in channel ────────────
    if (userId === MATSUO_USER_ID && !isDM && userText.includes(`<@${JAYDEN_USER_ID}>`)) {
      log("info", "hisho: matsuo mentioned jayden", { channel: channelId, thread: threadTs });
      const actionId = savePendingAction(channelId, threadTs, userText);
      log("info", "hisho: pending action created", { id: actionId, expiresIn: "10min" });
      // Don't process as a message to Vanessa — just monitor
      return;
    }

    // ── 秘書 Mode: 松尾さん message in channel (not mentioning Jayden) → just log, don't act
    if (userId === MATSUO_USER_ID && !isDM) {
      log("info", "hisho: matsuo message (no jayden mention, monitoring only)", { channel: channelId });
      return;
    }

    // ── Channel messages: only process if directed at Vanessa ─────────
    if (!isDM) {
      const mentionsVanessa = userText.includes(`<@${BOT_USER_ID}>`);
      const isReplyToVanessa = message.thread_ts && message.parent_user_id === BOT_USER_ID;
      if (!mentionsVanessa && !isReplyToVanessa) {
        return; // Not for us — skip silently
      }
      // Strip Vanessa @mention from text
      const cleanText = userText.replace(new RegExp(`<@${BOT_USER_ID}>`, "g"), "").trim();
      if (!cleanText) return;
    }

    // Save to message outbox BEFORE processing (crash-safe)
    const msgId = dbSaveMessage(channelId, userId, userText, message.thread_ts);

    log("info", "incoming message", {
      channel: channelId,
      user: userId,
      len: userText.length,
      thread: threadTs,
    });

    const history = await fetchRecentHistory(client, channelId, message.ts, message.thread_ts);
    const prompt = [
      history,
      `[Slack message from <@${userId}> in <#${channelId}>]`,
      userText,
    ].join("\n");

    const sessionKey = buildSessionKey(channelId, userId, message.thread_ts);

    // Status reaction: 👀 (acknowledged)
    const reactionTs = message.ts;
    await addReaction(client, channelId, reactionTs, "eyes");

    try {
      // Post initial streaming message
      let streamMsg = null;
      let lastUpdateLen = 0;
      const STREAM_UPDATE_INTERVAL = 1500; // update every 1.5s
      let lastUpdateTime = 0;

      const onChunk = async (fullText) => {
        const now = Date.now();
        // Throttle updates to avoid rate limiting
        if (now - lastUpdateTime < STREAM_UPDATE_INTERVAL) return;
        if (fullText.length - lastUpdateLen < 20) return; // skip tiny updates

        const displayText = fullText.trim().slice(0, 3900) + (fullText.length > 3900 ? '\n...' : '');
        if (!displayText) return;

        try {
          if (!streamMsg) {
            streamMsg = await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: displayText + " ✍️",
            });
          } else {
            await client.chat.update({
              channel: channelId,
              ts: streamMsg.ts,
              text: displayText + " ✍️",
            });
          }
          lastUpdateLen = fullText.length;
          lastUpdateTime = now;
        } catch {}
      };

      const chosenModel = selectModel(userText);
      log("info", "model selected", { model: chosenModel, len: userText.length });
      const response = await callMechatron(prompt, sessionKey, onChunk, chosenModel);

      // Status: 👀 → ✅
      await removeReaction(client, channelId, reactionTs, "eyes");
      await addReaction(client, channelId, reactionTs, "white_check_mark");

      // Final message: update stream message or post new
      const chunks = chunkMessage(response);
      if (streamMsg && chunks.length === 1) {
        // Update the streaming message with final content
        await client.chat.update({
          channel: channelId,
          ts: streamMsg.ts,
          text: chunks[0],
        });
      } else {
        // Delete stream preview if exists, post final chunked response
        if (streamMsg) {
          try { await client.chat.delete({ channel: channelId, ts: streamMsg.ts }); } catch {}
        }
        for (const chunk of chunks) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: chunk,
          });
        }
      }

      // Mark message as delivered in outbox
      if (msgId) dbMessageDone(msgId);

      // Remove ✅ after a delay
      setTimeout(() => removeReaction(client, channelId, reactionTs, "white_check_mark"), 5000);

      log("info", "replied", {
        channel: channelId,
        thread: threadTs,
        session: sessionKey,
        chunks: chunks.length,
        totalLen: response.length,
        streamed: !!streamMsg,
      });
    } catch (err) {
      // Status: 👀 → ❌
      await removeReaction(client, channelId, reactionTs, "eyes");
      await addReaction(client, channelId, reactionTs, "x");

      log("error", "handler error", {
        channel: channelId,
        error: err.message,
      });

      // Mark message as failed in outbox (will be retried)
      if (msgId) dbMessageFail(msgId, err.message?.slice(0, 200));

      // Clean error message — don't dump raw stderr to the user
      let userMessage = err.message || 'Unknown error';
      // Strip mechatron log lines from error
      userMessage = userMessage.replace(/\[mechatron\][^\n]*/g, '').trim();
      // Truncate long errors
      if (userMessage.length > 200) userMessage = userMessage.slice(0, 200) + '...';
      // If it's a known category, show a friendly message
      if (userMessage.includes('timed out')) userMessage = 'リクエストがタイムアウトしました。もう一度お試しください。';
      else if (userMessage.includes('rate limit') || userMessage.includes('429')) userMessage = 'APIレート制限に達しました。少し待ってから再度お試しください。';
      else if (userMessage.includes('ENOENT') || userMessage.includes('not found')) userMessage = 'システムエラーが発生しました。自動修復を試みています。';
      else if (userMessage.includes('exit code 1')) userMessage = '処理中にエラーが発生しました。もう一度お試しください。';

      await say({
        text: `:warning: ${userMessage}`,
        thread_ts: threadTs,
      });
    }
  });

  // ── Handle @mention in channels ─────────────────────────────────────
  app.event("app_mention", async ({ event, client }) => {
    // Someone @mentioned Vanessa in a channel
    if (!event.text || !event.text.trim()) return;

    const dedupeKey = `mention:${event.channel}:${event.ts}`;
    if (isDuplicate(dedupeKey)) return;

    const userText = event.text.replace(/<@[A-Z0-9]+>/g, "").trim(); // strip the @mention
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const userId = event.user;

    log("info", "app_mention", {
      channel: channelId,
      user: userId,
      len: userText.length,
      thread: threadTs,
    });

    // Save to outbox
    const msgId = dbSaveMessage(channelId, userId, userText, event.thread_ts);

    // Fetch thread/channel history for context
    const history = await fetchRecentHistory(client, channelId, event.ts, event.thread_ts);

    const prompt = [
      `[Slack @mention from <@${userId}> in <#${channelId}>]`,
      history,
      userText,
    ].join("\n");

    const sessionKey = `claw:slack:${channelId}:${userId}`;

    // React with 👀
    await addReaction(client, channelId, event.ts, "eyes");

    try {
      const chosenModel = selectModel(userText);
      const response = await callMechatron(prompt, sessionKey, null, chosenModel);

      await removeReaction(client, channelId, event.ts, "eyes");
      await addReaction(client, channelId, event.ts, "white_check_mark");

      const chunks = chunkMessage(response);
      for (const chunk of chunks) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: chunk,
        });
      }

      if (msgId) dbMessageDone(msgId);
      setTimeout(() => removeReaction(client, channelId, event.ts, "white_check_mark"), 5000);

      log("info", "mention replied", {
        channel: channelId,
        thread: threadTs,
        session: sessionKey,
        len: response.length,
      });
    } catch (err) {
      await removeReaction(client, channelId, event.ts, "eyes");
      await addReaction(client, channelId, event.ts, "x");

      if (msgId) dbMessageFail(msgId, err.message?.slice(0, 200));

      log("error", "mention error", { channel: channelId, error: err.message });

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `:warning: 処理中にエラーが発生しました。もう一度お試しください。`,
      });
    }
  });

  // ── Handle /claw slash command ──────────────────────────────────────
  app.command("/claw", async ({ command, ack, respond }) => {
    await ack();

    const userText = command.text?.trim();
    if (!userText) {
      await respond("使い方: `/claw <メッセージ>`");
      return;
    }

    log("info", "slash command", {
      channel: command.channel_id,
      user: command.user_id,
      len: userText.length,
    });

    const prompt = [
      `[/claw command from <@${command.user_id}> in <#${command.channel_id}>]`,
      userText,
    ].join("\n");

    const sessionKey = `claw:slash:${command.channel_id}:${command.user_id}`;

    try {
      await respond({
        text: "考え中... :hourglass_flowing_sand:",
        response_type: "ephemeral",
      });

      const chosenModel = selectModel(userText);
      const response = await callMechatron(prompt, sessionKey, null, chosenModel);

      await respond({
        text: response,
        response_type: "in_channel",
      });

      log("info", "slash replied", {
        channel: command.channel_id,
        session: sessionKey,
        len: response.length,
      });
    } catch (err) {
      log("error", "slash error", { error: err.message });
      await respond({
        text: `:warning: エラー: ${err.message}`,
        response_type: "ephemeral",
      });
    }
  });

  // ── Catch up on missed messages (on startup) ────────────────────────
  const pendingMsgs = dbGetPendingMessages();
  if (pendingMsgs.length > 0) {
    log("info", "catching up on missed messages", { count: pendingMsgs.length });
    for (const msg of pendingMsgs.slice(0, 5)) { // max 5 catch-ups per restart
      try {
        const apologyPrefix = "先ほどのメッセージに対応できず申し訳ございません。今から対応します。\n\n";
        const sessionKey = buildSessionKey(msg.channel, msg.user_id, msg.thread_ts);
        const prompt = `${apologyPrefix}[Catch-up: Slack message from <@${msg.user_id}> in <#${msg.channel}>]\n${msg.message_text}`;
        const response = await callMechatron(prompt, sessionKey);

        const threadTs = msg.thread_ts || msg.id; // best effort thread
        await app.client.chat.postMessage({
          channel: msg.channel,
          thread_ts: threadTs,
          text: response,
        });
        dbMessageDone(msg.id);
        log("info", "catch-up replied", { msgId: msg.id, channel: msg.channel });
      } catch (e) {
        log("error", "catch-up failed", { msgId: msg.id, error: e.message });
        dbMessageFail(msg.id, e.message?.slice(0, 200));
      }
    }
  }

  // Also recover any stalled tasks
  try {
    dbExecLegacy("recover");
  } catch {}

  // ── 秘書 Mode: Timer checker (runs every 60 seconds) ───────────────
  setInterval(async () => {
    const expired = getExpiredPendingActions();
    if (expired.length === 0) return;

    for (const action of expired) {
      log("info", "hisho: processing expired action", { id: action.id, channel: action.channel });

      const confidence = classifyConfidence(action.message_text);
      const threadKey = `${action.channel}:${action.thread_ts}`;
      const autoReplyCount = hishoAutoReplyCount.get(threadKey) || 0;

      try {
        if (confidence === "high" && autoReplyCount < HISHO_MAX_AUTO_REPLIES_PER_THREAD) {
          // High confidence: auto-reply in thread
          const prompt = `松尾さん（CEO）からJaydenへのメッセージに、Jaydenの代わりに回答してください。
スレッドで返信します。短く、事実に基づいて回答してください。
メモリやNotionの情報を使って正確に答えてください。

松尾さんのメッセージ: ${action.message_text}

回答のフォーマット:
Jaydenの代わりにVanessaがお返事いたします。

[回答内容]

※ AIアシスタントによる回答です。Jaydenが確認次第、補足・訂正する場合があります。`;

          const sessionKey = `claw:hisho:${action.channel}`;
          const chosenModel = selectModel(prompt);
          const response = await callMechatron(prompt, sessionKey, null, chosenModel);

          await app.client.chat.postMessage({
            channel: action.channel,
            thread_ts: action.thread_ts || undefined,
            text: response,
          });

          hishoAutoReplyCount.set(threadKey, autoReplyCount + 1);
          markPendingActionDone(action.id, "executed");
          log("info", "hisho: auto-replied", { id: action.id, confidence, channel: action.channel });

        } else if (confidence === "medium" || autoReplyCount >= HISHO_MAX_AUTO_REPLIES_PER_THREAD) {
          // Medium confidence or max auto-replies reached: DM Jayden with draft
          const prompt = `松尾さん（CEO）からのメッセージを要約し、返信ドラフトを作成してください。

松尾さんのメッセージ: ${action.message_text}
チャンネル: <#${action.channel}>

以下のフォーマットで出力:
📩 松尾さんからメッセージです

内容: [1-2行の要約]

💡 返信案: [提案する返信文]

チャンネルで直接ご返信ください。`;

          const sessionKey = `claw:hisho:dm`;
          const chosenModel = selectModel(prompt);
          const response = await callMechatron(prompt, sessionKey, null, chosenModel);

          await app.client.chat.postMessage({
            channel: JAYDEN_DM_CHANNEL,
            text: response,
          });

          markPendingActionDone(action.id, "executed");
          log("info", "hisho: dm'd jayden", { id: action.id, confidence, channel: action.channel });

        } else {
          // Low confidence: simple notification
          await app.client.chat.postMessage({
            channel: JAYDEN_DM_CHANNEL,
            text: `📩 松尾さんから <#${action.channel}> にメッセージです。確認お願いします。\n\n> ${(action.message_text || "").slice(0, 200)}`,
          });

          markPendingActionDone(action.id, "executed");
          log("info", "hisho: notified jayden", { id: action.id, confidence: "low", channel: action.channel });
        }
      } catch (err) {
        log("error", "hisho: action failed", { id: action.id, error: err.message });
        markPendingActionDone(action.id, "expired");
      }
    }
  }, 60_000); // Check every 60 seconds

  // ── Start ───────────────────────────────────────────────────────────
  await app.start();
  log("info", "slack bridge running (via mechatron)", {
    socketMode: true,
    defaultModel: MODEL_HAIKU,
    modelStrategy: `${MODEL_HAIKU} (default) / ${MODEL_SONNET} (complex)`,
    maxConcurrentSpawns: MAX_CONCURRENT_SPAWNS,
    maxTurns: MAX_TURNS,
    workspace: WORKSPACE,
  });
  console.error(
    `[${new Date().toISOString()}] Slack bridge running via mechatron (workspace=${WORKSPACE}, default_model=${MODEL_HAIKU})`
  );
}

main().catch((err) => {
  log("fatal", "startup failed", { error: err.message, stack: err.stack });
  process.exit(1);
});
