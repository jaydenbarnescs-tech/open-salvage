#!/usr/bin/env node
// ── Vanessa Dispatcher ────────────────────────────────────────────────────
// Receives Slack events via HTTP (Event Subscriptions), writes to queue.
// Runs on port 3100. Oracle nginx proxies /slack/* → SSH tunnel → this.
// No WebSocket — no dropped connections, no silent failures.
// vanessa-worker.js is the single-consumer that processes the queue.
// ─────────────────────────────────────────────────────────────────────────

"use strict";

const { App, HTTPReceiver } = require("@slack/bolt");
const Database   = require("better-sqlite3");
const crypto     = require("crypto");
const fs         = require("fs");
const path       = require("path");

// ── Constants ──────────────────────────────────────────────────────────────
const SLACK_BOT_TOKEN     = process.env.SLACK_BOT_TOKEN || "";
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "7a5433e6ce3c2a7fd07b3445b7128dd9";
const HTTP_PORT            = 3100;

const DB_PATH    = path.join(process.env.HOME, "clawd", "sessions", "agent.db");
const LOG_FILE   = path.join(process.env.HOME, "claude-agent", "logs", "dispatcher.log");
const PID_FILE   = "/tmp/vanessa-dispatcher.pid";

// User IDs
const MATSUO_USER_ID  = "U09DR063A59";
const JAYDEN_USER_ID  = "U0AM9DC9SJW";
const JAYDEN_DM_CHAN  = "D0AQW7VF4UA";

// 秘書 mode: 10-minute timer before Vanessa acts on 松尾さん's messages
const HISHO_DELAY_MS  = 10 * 60 * 1000;

// Priority scores
const P = {
  HISHO_TIMER: 9,   // 秘書 auto-reply (fires after 10 min with no Jayden reply)
  JAYDEN_DM:   8,   // Jayden DM or any DM from known user
  MENTION:     7,   // @Vanessa in channel
  SLASH:       6,   // /claw command
  CHANNEL:     5,   // general channel message
  CRON:        3,   // scheduled task (not from Slack event)
};

// ── DB ─────────────────────────────────────────────────────────────────────
let db;
let stmts = {};

function openDb() {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  runMigrations();
}

function runMigrations() {
  // Idempotent — safe to run every startup
  const existing = db.prepare("PRAGMA table_info(message_outbox)").all().map(r => r.name);
  const addCol = (col, def) => {
    if (!existing.includes(col)) {
      db.prepare(`ALTER TABLE message_outbox ADD COLUMN ${col} ${def}`).run();
    }
  };
  addCol("priority",     "INTEGER DEFAULT 5");
  addCol("message_type", "TEXT DEFAULT 'dm'");
  addCol("slack_ts",     "TEXT");
  addCol("session_key",  "TEXT");
  addCol("claimed_at",   "TEXT");
  addCol("worker_pid",   "INTEGER");
  addCol("stale_after",  "TEXT");

  db.prepare("CREATE INDEX IF NOT EXISTS idx_outbox_priority ON message_outbox(status, priority DESC, created_at ASC)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_dedup ON message_outbox(channel, slack_ts) WHERE slack_ts IS NOT NULL").run();

  // pending_actions: ensure cancelled_reason exists
  const paExisting = db.prepare("PRAGMA table_info(pending_actions)").all().map(r => r.name);
  if (!paExisting.includes("cancelled_reason")) {
    db.prepare("ALTER TABLE pending_actions ADD COLUMN cancelled_reason TEXT").run();
  }
}

function prepareStatements() {
  stmts.enqueue = db.prepare(`
    INSERT OR IGNORE INTO message_outbox
      (id, channel, user_id, thread_ts, slack_ts, message_text,
       message_type, priority, session_key, stale_after, status)
    VALUES
      (?, ?, ?, ?, ?, ?,
       ?, ?, ?, datetime('now', '+2 hours'), 'pending')
  `);

  stmts.savePendingAction = db.prepare(`
    INSERT OR REPLACE INTO pending_actions
      (id, type, channel, thread_ts, trigger_user, target_user, message_text, status, expires_at)
    VALUES (?, 'matsuo_reply', ?, ?, ?, ?, ?, 'waiting', ?)
  `);

  stmts.cancelPendingThread = db.prepare(`
    UPDATE pending_actions
    SET status = 'cancelled', cancelled_reason = ?
    WHERE channel = ? AND thread_ts = ? AND status = 'waiting'
  `);

  stmts.cancelPendingChannel = db.prepare(`
    UPDATE pending_actions
    SET status = 'cancelled', cancelled_reason = ?
    WHERE channel = ? AND status = 'waiting'
  `);

  stmts.restoreTimers = db.prepare(`
    SELECT * FROM pending_actions
    WHERE status = 'waiting' AND expires_at > datetime('now')
  `);

  // Queue depth — for watchdog logging
  stmts.pendingCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM message_outbox WHERE status = 'pending'
  `);
}

// Enqueue one message — synchronous write (better-sqlite3), so if it throws Bolt won't ack
function enqueue(channel, userId, text, threadTs, slackTs, messageType, priority, sessionKey) {
  const id = crypto.randomUUID();
  try {
    const txn = db.transaction(() => {
      stmts.enqueue.run(id, channel, userId, threadTs || null, slackTs, text, messageType, priority, sessionKey);
    });
    txn();
    return id;
  } catch (e) {
    log("error", "enqueue failed", { error: e.message });
    return null;
  }
}

// ── 秘書 Mode ───────────────────────────────────────────────────────────────
const hishoTimers = new Map(); // key = `${channel}:${threadTs}`

function scheduleHisho(channel, threadTs, messageText, expiresAt) {
  const key = `${channel}:${threadTs}`;
  if (hishoTimers.has(key)) return;
  const delay = new Date(expiresAt) - Date.now();
  if (delay <= 0) {
    // Already expired — worker will pick it up on next poll via pending_actions check
    return;
  }
  const timer = setTimeout(() => {
    hishoTimers.delete(key);
    // Insert as high-priority job into the queue
    enqueue(
      channel, MATSUO_USER_ID, messageText,
      threadTs, `hisho:${threadTs}`,
      "hisho", P.HISHO_TIMER,
      `claw:hisho:${channel}:${threadTs}`
    );
    log("info", "hisho: timer fired, queued", { channel, thread: threadTs });
  }, delay);
  hishoTimers.set(key, timer);
}

function cancelHisho(channel, threadTs) {
  const key = `${channel}:${threadTs}`;
  if (hishoTimers.has(key)) {
    clearTimeout(hishoTimers.get(key));
    hishoTimers.delete(key);
  }
}

function restoreHishoTimers() {
  const rows = stmts.restoreTimers.all();
  for (const row of rows) {
    scheduleHisho(row.channel, row.thread_ts, row.message_text, row.expires_at);
  }
  if (rows.length > 0) log("info", `hisho: restored ${rows.length} timer(s) from DB`);
}

// (set after auth.test resolves in main)
let BOT_USER_ID = null;

// ── Message debounce buffer ────────────────────────────────────────────────
// When a user sends several messages in rapid succession, hold them for
// DEBOUNCE_MS and flush as a single combined job — prevents Vanessa from
// replying individually to every line in a burst.
const DEBOUNCE_MS  = 4_000;
const msgBuffer    = new Map(); // key → { timer, messages: [{ts, text}], client, isDM, channelId, userId, firstThreadTs }

function flushMsgBuffer(key) {
  const buf = msgBuffer.get(key);
  if (!buf) return;
  msgBuffer.delete(key);

  const { messages, client, isDM, channelId, userId, firstTs, firstThreadTs } = buf;
  const combined   = messages.map(m => m.text).join("\n");
  const lastTs     = messages[messages.length - 1].ts;
  const threadTs   = isDM ? lastTs : firstThreadTs; // DMs: reply under last msg; threads: keep original thread
  const priority   = calcPriority(channelId, userId, BOT_USER_ID && combined.includes(`<@${BOT_USER_ID}>`));
  const sessionKey = buildSessionKey(channelId, userId);

  const id = enqueue(channelId, userId, combined, threadTs, firstTs, isDM ? "dm" : "mention", priority, sessionKey);
  if (id) {
    const pending = stmts.pendingCount.get().cnt;
    log("info", "queued (batched)", { id, channel: channelId, user: userId, count: messages.length, priority, queueDepth: pending });
  }
}

// ── Dedup: in-memory fast path (DB UNIQUE index is the real guard) ─────────
const dedupCache = new Map();
function isDuplicate(channel, slackTs) {
  const key = `${channel}:${slackTs}`;
  const now  = Date.now();
  if (dedupCache.size > 500) {
    for (const [k, ts] of dedupCache) if (now - ts > 60_000) dedupCache.delete(k);
  }
  if (dedupCache.has(key) && now - dedupCache.get(key) < 60_000) return true;
  dedupCache.set(key, now);
  return false;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function buildSessionKey(channelId, userId) {
  return `claw:slack:${channelId}:${userId}`;
}

function calcPriority(channelId, userId, mentionsBot) {
  if (channelId === JAYDEN_DM_CHAN)           return P.JAYDEN_DM;
  if (channelId.startsWith("D"))             return P.JAYDEN_DM;  // any DM
  if (mentionsBot)                            return P.MENTION;
  return P.CHANNEL;
}

function log(level, msg, meta = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta }) + "\n";
  process.stdout.write(entry);
  // Only write to file when stdout is a TTY (i.e. manual terminal run).
  // When running under LaunchAgent, stdout is already redirected to the log file.
  if (process.stdout.isTTY) {
    try { fs.appendFileSync(LOG_FILE, entry); } catch {}
  }
}

async function addReaction(client, channel, ts, emoji) {
  try { await client.reactions.add({ channel, timestamp: ts, name: emoji }); } catch {}
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

  fs.writeFileSync(PID_FILE, String(process.pid));
  process.on("exit",    () => { try { fs.unlinkSync(PID_FILE); } catch {} });
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT",  () => process.exit(0));

  openDb();
  prepareStatements();
  restoreHishoTimers();

  // HTTP mode — no WebSocket, no dropped connections
  // Slack POSTs events to https://mgc-pass-proxy.duckdns.org/slack/events
  // Oracle nginx → SSH tunnel → this process on port 3100
  const receiver = new HTTPReceiver({
    signingSecret: SLACK_SIGNING_SECRET,
    port: HTTP_PORT,
    endpoints: "/slack/events",
  });

  const app = new App({
    token:    SLACK_BOT_TOKEN,
    receiver,
  });

  try {
    const auth = await app.client.auth.test({ token: SLACK_BOT_TOKEN });
    BOT_USER_ID = auth.user_id;
    log("info", "authenticated", { botUserId: BOT_USER_ID });
  } catch (e) {
    log("error", "auth.test failed", { error: e.message });
  }

  // ── DMs + channel messages ─────────────────────────────────────────────
  app.message(async ({ message, client }) => {
    // Filter: bots, subtypes (join/leave/etc), empty
    if (message.bot_id || message.subtype) return;
    if (!message.text?.trim()) return;
    if (isDuplicate(message.channel, message.ts)) return;

    const channelId = message.channel;
    const userId    = message.user;
    const text      = message.text.trim();
    const isDM      = channelId.startsWith("D");
    const threadTs  = message.thread_ts || message.ts;

    // ── 秘書: Jayden replies in a channel thread → cancel pending hisho ─
    if (userId === JAYDEN_USER_ID && !isDM && message.thread_ts) {
      stmts.cancelPendingThread.run("jayden_replied", channelId, message.thread_ts);
      cancelHisho(channelId, message.thread_ts);
    }

    // ── 秘書: 松尾さん @mentions Jayden → start 10-min timer ────────────
    if (userId === MATSUO_USER_ID && !isDM && text.includes(`<@${JAYDEN_USER_ID}>`)) {
      const id         = crypto.randomUUID();
      const expiresAt  = new Date(Date.now() + HISHO_DELAY_MS).toISOString();
      stmts.savePendingAction.run(id, channelId, threadTs, MATSUO_USER_ID, JAYDEN_USER_ID, text, expiresAt);
      scheduleHisho(channelId, threadTs, text, expiresAt);
      await addReaction(client, channelId, message.ts, "eyes");
      log("info", "hisho: timer started (10 min)", { channel: channelId, thread: threadTs });
      return; // don't queue as normal message — Vanessa is just watching
    }

    // ── 秘書: 松尾さん general channel message (no Jayden @mention) → observe only
    if (userId === MATSUO_USER_ID && !isDM) return;

    // ── Channel messages: only if directed at Vanessa ───────────────────
    if (!isDM) {
      const mentionsVanessa   = BOT_USER_ID && text.includes(`<@${BOT_USER_ID}>`);
      const isReplyToVanessa  = message.thread_ts && message.parent_user_id === BOT_USER_ID;
      if (!mentionsVanessa && !isReplyToVanessa) return;
    }

    // React immediately so Jayden sees 👀 without waiting for the debounce
    await addReaction(client, channelId, message.ts, "eyes");

    // Debounce: accumulate burst messages, flush as one job after silence
    const bufKey = `${channelId}:${userId}`;
    if (msgBuffer.has(bufKey)) {
      const buf = msgBuffer.get(bufKey);
      clearTimeout(buf.timer);
      buf.messages.push({ ts: message.ts, text });
      buf.timer = setTimeout(() => flushMsgBuffer(bufKey), DEBOUNCE_MS);
    } else {
      msgBuffer.set(bufKey, {
        messages:      [{ ts: message.ts, text }],
        client,
        isDM,
        channelId,
        userId,
        firstTs:       message.ts,
        firstThreadTs: threadTs,
        timer:         setTimeout(() => flushMsgBuffer(bufKey), DEBOUNCE_MS),
      });
    }
  });

  // ── @mention in channel ────────────────────────────────────────────────
  app.event("app_mention", async ({ event, client }) => {
    if (!event.text?.trim()) return;
    if (isDuplicate(event.channel, event.ts)) return;

    const text      = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) return;

    const threadTs   = event.thread_ts || event.ts;
    const sessionKey = buildSessionKey(event.channel, event.user);

    const id = enqueue(event.channel, event.user, text, threadTs, event.ts, "mention", P.MENTION, sessionKey);
    if (id) {
      await addReaction(client, event.channel, event.ts, "eyes");
      log("info", "queued mention", { id, channel: event.channel, user: event.user });
    }
  });

  // ── /claw slash command ────────────────────────────────────────────────
  app.command("/claw", async ({ command, ack, respond }) => {
    await ack();
    const text = command.text?.trim();
    if (!text) { await respond("使い方: `/claw <メッセージ>`"); return; }

    const sessionKey = `claw:slash:${command.channel_id}:${command.user_id}`;
    const slashTs    = `slash:${Date.now()}`;

    const id = enqueue(command.channel_id, command.user_id, text, null, slashTs, "slash", P.SLASH, sessionKey);
    if (id) {
      await respond({ text: "考え中... :hourglass_flowing_sand:", response_type: "ephemeral" });
      log("info", "queued slash", { id, channel: command.channel_id, user: command.user_id });
    } else {
      await respond({ text: ":warning: キューに追加できませんでした", response_type: "ephemeral" });
    }
  });

  await app.start();
  log("info", "dispatcher started (HTTP mode)", {
    pid:  process.pid,
    port: HTTP_PORT,
    url:  "https://mgc-pass-proxy.duckdns.org/slack/events",
  });

  // Log queue depth every 5 min — useful for debugging
  setInterval(() => {
    const cnt = stmts.pendingCount.get().cnt;
    if (cnt > 0) log("info", "queue depth", { pending: cnt });
  }, 5 * 60_000);
}

main().catch(e => {
  log("error", "fatal crash", { error: e.message, stack: e.stack?.slice(0, 500) });
  process.exit(1);
});
