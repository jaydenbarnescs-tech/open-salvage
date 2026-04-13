# openSalvage Architecture

openSalvage is a self-hosted AI agent framework built on Claude Code CLI (OpenClaw harness). It pulls the best patterns from across open-source agent tooling and bolts them onto a single production system running on macOS.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INBOUND CHANNELS                            │
│                                                                     │
│   Slack (Socket Mode)          Voice (Whisper proxy)                │
│        │                               │                            │
│        └───────────────┬───────────────┘                            │
│                        ▼                                            │
│              slack-bridge.js                                        │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        AGENT WORKER                                 │
│                                                                     │
│   vanessa-worker.js                                                 │
│   ├── Pull mem0 memories (FAISS + Ollama)                           │
│   ├── Pull episodic memory (salvage-memory-search)                  │
│   ├── Build Claude prompt (system + context + user message)         │
│   ├── Call Claude via Claude API proxy (tool_use loop)                     │
│   └── Enforce memory-update after every response                    │
└───────────┬──────────────────────┬──────────────────────────────────┘
            │                      │
            ▼                      ▼
┌───────────────────┐   ┌──────────────────────────────────────────┐
│   salvage (CLI)   │   │          salvage-tools (MCP executor)    │
│   OpenClaw harness│   │   ├── mcp-claim → mcp_slots table        │
│   Claude Code CLI │   │   ├── if < 5 running: execute live       │
│   subprocess call │   │   ├── if ≥ 5 running: queue + signal     │
└───────────────────┘   │   └── MCP servers: Notion, Slack, n8n…   │
                        └──────────────────┬───────────────────────┘
                                           │
                         ┌─────────────────▼──────────────────┐
                         │         SQLite agent.db             │
                         │  tasks / message_outbox /           │
                         │  mcp_slots / runs                   │
                         └─────────────────┬──────────────────┘
                                           │
                         ┌─────────────────▼──────────────────┐
                         │      salvage-task-poller            │
                         │  (LaunchAgent, 60s heartbeat)       │
                         │  ├── recover stalled tasks          │
                         │  ├── dispatch pending tasks         │
                         │  └── promote queued MCP slots       │
                         └────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         MEMORY LAYER                                │
│                                                                     │
│   Layer 1: mem0                    Layer 2: memory index            │
│   ├── FAISS on disk                ├── SQLite FTS5                  │
│   ├── Ollama qwen3-embedding:0.6b  ├── bge-m3 embeddings            │
│   ├── Claude Haiku (extraction)    ├── workspace markdown files     │
│   ├── 50-memory cap + eviction     └── hybrid search (0.7/0.3)     │
│   └── 0.95 cosine dedup                                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       BACKGROUND SERVICES                           │
│                                                                     │
│   com.opensalvage.salvage-task-poller   — main task dispatch loop           │
│   com.opensalvage.salvage-watchdog      — health monitor + auto-restart     │
│   com.opensalvage.salvage-memory        — memory indexer daemon             │
│   com.salvage.cron.*            — scheduled cron jobs               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Subsystems

### Slack Bridge (`claude-agent/slack-bridge.js`)

The inbound gateway. Connects to Slack via Socket Mode (no public webhook required). Receives events, routes them to the agent worker, and posts responses back.

Key behaviors:
- Voice messages are transcribed via the Whisper proxy before being forwarded
- Thread context is preserved and passed to the worker
- Outbound messages can also be queued to `message_outbox` for guaranteed delivery with retry

### Agent Worker (`claude-agent/vanessa-worker.js`)

The orchestration layer between Slack and Claude. For each inbound message:

1. Query both memory layers for relevant context
2. Build the full Claude prompt: system instructions + memory context + conversation history + current message
3. Send to Claude via the Claude API proxy
4. Run the tool_use loop until Claude signals completion
5. Enforce a memory-update call after every non-trivial response
6. Deliver the final message back to Slack

The worker runs the two-phase execute-then-respond pattern (from LangGraph): all tool calls are completed before the final response is generated.

### salvage (Harness Launcher, `bin/salvage`)

The main entry point for invoking Claude Code CLI. Wraps `claude` with the right workspace, model, permissions, and flags. Used by the worker, the task poller, and salvage-tools.

Key flags:
- `--workspace` — sets the working directory for the Claude session
- `--task` / `--task-id` — attaches the session to a task record in SQLite
- `--no-mcp` — skips MCP server loading (used for fast task processing)
- `--fresh` — starts a new conversation context
- `--dangerously-skip-permissions` — required for autonomous task processing

### salvage-tools (`bin/salvage-tools`)

The MCP tool executor. Called by the agent whenever it needs an external tool (Notion, n8n, Slack, etc.). Each invocation:

1. Reads standing instructions from mem0 (`all.py`)
2. Calls `salvage-db mcp-claim` to atomically acquire a running slot
3. If capacity is available: spawns `salvage` with MCP servers loaded, streams output, marks slot done
4. If at capacity: returns a structured JSON "queued" response, touches the dispatch-signal file

When spawned by the poller (`SALVAGE_FROM_POLLER=1`), skips the mcp-claim step entirely — the poller already claimed the slot.

### salvage-db (`bin/salvage-db`)

SQLite database CLI. All state — tasks, outbox messages, MCP slots, run history — lives in `~/clawd/sessions/agent.db`. Every write is atomic. Every read is indexed. WAL mode is enabled for crash safety.

### salvage-task-poller (`bin/salvage-task-poller`)

Background daemon. Runs every 60 seconds via LaunchAgent. Also wakes immediately when `~/.salvage/dispatch-signal` is touched. Three responsibilities:

1. Recover stalled tasks (expired `visibility_timeout` → reset to `pending`)
2. Dispatch up to 2 pending tasks per cycle via `salvage`
3. Promote up to 2 queued MCP slots per cycle to running via `salvage-tools`

### salvage-memory-index (`bin/salvage-memory-index`)

Indexes all workspace markdown files into a SQLite FTS5 table plus bge-m3 vector embeddings. Files are chunked at 1400 characters with 280-character overlap. Tracks file hashes to skip unchanged content. Runs as a daemon via LaunchAgent.

### salvage-memory-search (`bin/salvage-memory-search`)

Hybrid search over the memory index. Embeds the query with bge-m3, scores all chunks by cosine similarity (weight 0.7) and FTS5 BM25 rank (weight 0.3), returns the top N results. Falls back to text-only if Ollama is unavailable.

### salvage-memory-read (`bin/salvage-memory-read`)

Reads the agent's core memory markdown file (`vanessa-core-memory.md`). Used to hydrate the agent's self-model at session start.

### salvage-spawn (`bin/salvage-spawn`)

Spawns sub-agents for parallel work. Creates a child task in SQLite, launches a fresh `salvage` session in the background, and returns the task ID so the parent can poll for results.

### salvage-ingest (`bin/salvage-ingest`)

Ingests external documents (PDFs, text, web pages) into the memory index. Writes normalized markdown to `memory/ingested/` and triggers a re-index.

### salvage-watchdog (`bin/salvage-watchdog`)

Health monitor. Runs every 5 minutes. Checks all critical LaunchAgent services, auto-restarts crashed processes, and sends a Slack DM alert only when it cannot self-heal. Enforces a 10-minute cooldown between restarts of the same service and a max of 10 restarts/hour.

### salvage-cron (`bin/salvage-cron`)

Cron job runner for scheduled agent tasks. Each cron job is a LaunchAgent with a `StartInterval`. The cron script resolves which job to run and invokes `salvage` with the appropriate task payload.

### salvage-backlog-recovery (`bin/salvage-backlog-recovery`)

Recovers stalled tasks that have been stuck in `running` or `claimed` state past their `visibility_timeout`. Resets them to `pending` so the poller can pick them up again. Designed to be run manually or as a recovery cron job.

---

## Data Flow: Slack Message to Response

```
1. Slack event arrives via Socket Mode
        │
        ▼
2. slack-bridge.js receives → (voice: Whisper transcription)
        │
        ▼
3. vanessa-worker.js picks up the message
        │
        ├─ 3a. mem0 search (FAISS vector search, top 10)
        ├─ 3b. salvage-memory-search (FTS5 + bge-m3 hybrid, top 6)
        └─ 3c. salvage-memory-read (core identity/instructions)
        │
        ▼
4. Build Claude prompt
   [system instructions] + [memory context] + [conversation history] + [user message]
        │
        ▼
5. POST to Claude via Claude API proxy (/v1/messages)
        │
        ▼
6. Claude responds with tool_use blocks
        │
        ▼
7. Tool dispatch loop
   ├─ Internal tools (bash, file read/write): handled by salvage directly
   └─ External tools (Notion, Slack, n8n, etc.): routed through salvage-tools
           │
           ├─ mcp-claim → slot acquired (running) or deferred (queued)
           ├─ if running: spawn salvage with MCP servers, await result
           └─ if queued: return JSON {status: "queued", slot_id: "..."}
        │
        ▼
8. All tool calls resolved → Claude generates final text response
        │
        ▼
9. Enforce memory update (extract facts → mem0.add())
        │
        ▼
10. Post response to Slack thread
```

---

## SQLite Schema

Database: `~/clawd/sessions/agent.db`  
Mode: WAL, `busy_timeout=5000ms`

### `tasks`

Durable task state machine (SwarmClaw pattern).

```sql
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  status            TEXT DEFAULT 'pending'
                    CHECK(status IN ('pending','claimed','running','done','failed','cancelled','handoff')),
  assigned_agent    TEXT,
  payload           TEXT DEFAULT '{}',
  result            TEXT,
  parent_task_id    TEXT REFERENCES tasks(id),
  source            TEXT,
  source_ref        TEXT,
  priority          INTEGER DEFAULT 0,
  retry_count       INTEGER DEFAULT 0,
  max_retries       INTEGER DEFAULT 3,
  visibility_timeout TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  claimed_at        TEXT,
  completed_at      TEXT,
  error             TEXT
);
```

Claim is atomic via `UPDATE … WHERE id = (SELECT … LIMIT 1) RETURNING *`. The `visibility_timeout` extends on heartbeat; the poller resets expired rows to `pending`.

### `message_outbox`

Guaranteed message delivery with retry (OpenClaw Issue #32063 pattern).

```sql
CREATE TABLE message_outbox (
  id             TEXT PRIMARY KEY,
  channel        TEXT NOT NULL,
  user_id        TEXT,
  thread_ts      TEXT,
  message_text   TEXT NOT NULL,
  status         TEXT DEFAULT 'pending'
                 CHECK(status IN ('pending','processing','delivered','failed','expired')),
  retry_count    INTEGER DEFAULT 0,
  max_retries    INTEGER DEFAULT 5,
  next_retry_at  TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  processed_at   TEXT,
  error          TEXT
);
```

### `mcp_slots`

MCP tool concurrency control. See [docs/MCP-CONCURRENCY.md](docs/MCP-CONCURRENCY.md) for full details.

```sql
CREATE TABLE mcp_slots (
  id           TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK(status IN ('queued','running','done','failed')),
  claimed_by   INTEGER,    -- PID of the owning salvage-tools process
  instruction  TEXT,       -- first 200 chars of the tool instruction
  workspace    TEXT,
  result       TEXT,
  error        TEXT,
  queued_at    TEXT DEFAULT (datetime('now')),
  started_at   TEXT,
  completed_at TEXT
);
```

### `runs`

Execution history for monitoring and debugging.

```sql
CREATE TABLE runs (
  id           TEXT PRIMARY KEY,
  task_id      TEXT REFERENCES tasks(id),
  agent        TEXT NOT NULL,
  workspace    TEXT,
  session_key  TEXT,
  started_at   TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  status       TEXT DEFAULT 'running',
  duration_ms  INTEGER,
  exit_code    INTEGER,
  error        TEXT
);
```

---

## Memory Retrieval Flow

Each request to the agent triggers a parallel retrieval across both memory layers:

```
User message
    │
    ├─── mem0.search(query, limit=10)
    │         FAISS cosine similarity
    │         qwen3-embedding:0.6b → 1024-dim vectors
    │         Returns: facts, instructions, preferences, commitments
    │
    └─── salvage-memory-search <workspace> <query>
              bge-m3 vector (0.7 weight) + FTS5 BM25 (0.3 weight)
              Returns: workspace markdown chunks (episodic/project memory)

Both results merged → injected into Claude system prompt
```

The two layers are complementary:
- **mem0** stores extracted operational facts (structured, deduplicated, capped at 50)
- **memory-index** stores the raw episodic record (workspace markdown, unlimited, searchable)

---

## MCP Concurrency Control

Two-tier dispatch prevents zombie Claude processes under API load. Full details in [docs/MCP-CONCURRENCY.md](docs/MCP-CONCURRENCY.md).

**Live tier:** `salvage-tools` atomically claims a running slot via `BEGIN IMMEDIATE`. If fewer than 5 slots are running, the slot starts immediately.

**Queue tier:** If at capacity, the slot is inserted as `queued`, the process exits with a JSON response, and `~/.salvage/dispatch-signal` is touched.

**Poller promotion:** Every 60 seconds (or immediately on signal), the poller runs `mcp-recover` (dead PID check) then `mcp-next` up to 2 times, promoting queued slots to running.

---

## Service Topology

```
macOS LaunchAgents
├── com.opensalvage.salvage-task-poller     60s heartbeat + dispatch-signal wake
├── com.opensalvage.salvage-watchdog        5-minute health check loop
├── com.opensalvage.salvage-memory          memory indexer daemon
├── com.mgc.vanessa-worker          agent worker process
├── com.mgc.vanessa-dispatcher      message dispatcher
├── com.mgc.vanessa-slack-tunnel    Slack bridge
├── com.mgc.whisper-proxy           Whisper transcription service
├── com.mgc.whisper-server          Whisper model server
├── com.mgc.mac-proxy               Claude API proxy
├── ai.openclaw.gateway             OpenClaw harness gateway
└── com.salvage.cron.*
    ├── hourly-status               hourly status summary
    ├── linkedin-strategy           LinkedIn content strategy jobs
    ├── linkedin-jayden-context     LinkedIn context refresh
    ├── linkedin-web-scout          web scouting for LinkedIn
    └── overseas-buyer-outreach     outbound outreach automation
```

All services log to `~/claude-agent/logs/`. The watchdog monitors `com.opensalvage.salvage-task-poller`, `com.mgc.vanessa-worker`, and the Claude binary symlink. See [docs/SERVICES.md](docs/SERVICES.md) for load/unload instructions.
