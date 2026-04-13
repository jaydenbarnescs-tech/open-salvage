# openSalvage

> The production agent framework for Claude Code CLI — built from the inside.

---

## The problem everyone ran into

When people try to build agent frameworks on top of Claude, they take the obvious path: wrap Claude CLI like an API. Call it programmatically. Treat it like a black box you can plug into any orchestration layer.

**Anthropic detects this.** When you use Claude CLI as a proxy or API wrapper, it knows. The result: you get throttled, and you lose access to Sonnet and Opus — you're locked to Haiku only.

Every major agent framework that tried to bolt Claude CLI on after the fact hit this wall.

---

## What openSalvage does differently

openSalvage was not built as a wrapper around Claude Code CLI. **It was built from inside it, from day one.**

The framework works with Claude Code's native architecture — the way it handles sessions, tool calls, sub-agents, and workspace context — rather than trying to intercept or proxy it. Because it is not pretending to be something it isn't, Anthropic's systems do not treat it as abuse.

The result:
- **Full model access** — Sonnet and Opus, not just Haiku
- **No throttling** — the same rate limits as normal Claude Code usage
- **No API key needed** — runs entirely off your Claude.ai subscription (Max plan)
- **No extra billing** — your subscription covers everything

This is what people building on Claude Code have wanted and nobody has shipped.

---

## What it is

A self-hosted agent framework assembled from the best patterns across the open-source AI landscape — persistent memory, durable task queue, concurrent execution control, background services, and real-time Slack integration — all running on top of Claude Code CLI, the right way.

---

## The concept

The name comes from a simple idea: don't build from scratch when the best patterns already exist. Go through the open-source AI ecosystem, identify what is genuinely best-in-class in each area — memory, orchestration, state management, tool execution — take those patterns, and assemble them onto a single framework.

That is openSalvage. Every component traces back to deep research into the top projects in its space.

---

## What it assembles

| Source | What was taken |
|---|---|
| [Claude Code CLI](https://docs.anthropic.com/claude-code) | The agent engine — every LLM call, every tool use, every sub-agent |
| [mem0](https://github.com/mem0ai/mem0) | FAISS-backed semantic memory with category-based extraction |
| [LangGraph](https://github.com/langchain-ai/langgraph) | Two-phase execute-then-respond agent loop pattern |
| AutoGPT | Autonomous background task queue with poller daemon |
| SwarmClaw | SQLite durable state machine for task and slot tracking |
| [Ollama](https://ollama.ai) | Local embeddings (qwen3-embedding:0.6b, bge-m3) — no data leaves your machine |

The result has been running continuously in a real business — handling Slack messages, executing autonomous tasks, managing memory across sessions, and coordinating parallel work — without the 100+ zombie-process issues that come from naive Claude API usage.

---

## What's inside

### Core tools (`bin/`)

| Script | What it does |
|---|---|
| `salvage` | Main harness launcher — starts the agent with workspace context |
| `salvage-db` | SQLite CLI — manages tasks, message outbox, MCP slots, run history |
| `salvage-tools` | MCP tool executor with built-in concurrency control |
| `salvage-task-poller` | Background daemon — promotes queued slots, runs autonomous tasks |
| `salvage-memory-index` | Builds hybrid FTS5 + embedding index over workspace markdown |
| `salvage-memory-search` | Semantic + keyword search across workspace memory |
| `salvage-memory-read` | Reads the agent's core operational memory file |
| `salvage-spawn` | Spawns sub-agents for parallel task execution |
| `salvage-ingest` | Ingests documents into the memory index |
| `salvage-watchdog` | Monitors services, restarts dead processes |
| `salvage-cron` | Runs scheduled agent tasks on a cron schedule |
| `salvage-backlog-recovery` | Recovers stalled tasks after crashes or restarts |

### Memory (two layers)

**Layer 1 — Semantic facts (mem0 + FAISS)**
Stores extracted facts, instructions, preferences, and commitments as dense vectors. Uses Ollama locally for embeddings — nothing leaves your machine. 50-memory cap with cosine dedup (0.95 threshold) and automatic eviction of the least-recently-used entries.

**Layer 2 — Episodic workspace index (SQLite FTS5 + bge-m3)**
Builds a hybrid keyword + semantic index over all markdown files in your workspace. Acts as long-term episodic memory — the agent can search its own notes, daily logs, and documents from any session.

Both layers are queried together. The agent gets the right context without you manually managing what it should remember.

### MCP Concurrency Control

The core problem: if every incoming message spawns a Claude Code subprocess, you end up with 100+ concurrent processes hammering the Anthropic API, getting rate-limited, and never cleaning up.

The solution is a two-tier dispatch backed by SQLite:

```
Incoming request
       │
       ▼
salvage-db mcp-claim
       │
    ┌──┴──┐
    │     │
running  queued
(≤5)    (overflow)
    │     │
    │     └──► dispatch-signal file → poller wakes → promotes when slot frees
    │
    ▼
salvage-tools executes
    │
    ▼
salvage-db mcp-done
```

`BEGIN IMMEDIATE` + CTE atomically counts running slots and either claims a running slot or creates a queued entry. Dead processes are recovered on every poller cycle by checking `kill -0 $pid` against each running slot's stored PID.

### Background services (macOS LaunchAgents)

| Service | Purpose |
|---|---|
| `com.opensalvage.salvage-task-poller` | Main task loop — runs every 60s |
| `com.opensalvage.salvage-watchdog` | Health monitor — restarts dead services |
| `com.opensalvage.salvage-memory` | Memory indexer daemon |
| `com.salvage.cron.*` | Scheduled agent tasks (customisable) |

### Slack integration

A Socket Mode Slack bot receives messages, routes them through the agent worker, handles voice transcription via Whisper, and posts responses back. The worker enforces memory-update calls so the agent's knowledge persists across sessions — not just within them.

---

## Requirements

- macOS (LaunchAgents are macOS-specific; core scripts are portable)
- **[Claude Code CLI](https://docs.anthropic.com/claude-code)** — logged in with a Claude.ai account (Max plan recommended). This is the engine everything runs on.
- Node.js 20+
- Python 3.11+
- [Ollama](https://ollama.ai) running locally (for embeddings — no data leaves your machine)
- SQLite3
- A Slack bot token (for the Slack bridge — optional if you only want the CLI)

---

## Installation

```bash
git clone https://github.com/jaydenbarnescs-tech/open-salvage.git
cd open-salvage
./install.sh
```

`install.sh` does the following:
1. Symlinks all `bin/salvage*` scripts into `~/bin/`
2. Creates `~/.salvage/` runtime directory with default config
3. Copies LaunchAgent plists with your home directory substituted in
4. Loads core LaunchAgents (poller, watchdog, memory indexer)
5. Runs `npm install` in `claude-agent/`
6. Initialises the SQLite database via `salvage-db init`

---

## Configuration

```bash
cp config/mcp-config.example.json config/mcp-config.json
# Edit config/mcp-config.json — add your API keys and Slack tokens
```

Key config values:

| Key | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Slack app-level token (`xapp-...`) for Socket Mode |
| `OLLAMA_BASE_URL` | Ollama endpoint (default: `http://localhost:11434`) |
| `MCP_PROXY_URL` | Optional MCP proxy for remote tool access |

> **Note on Claude auth:** The main agent runs via the Claude Code CLI, which authenticates directly with your Claude.ai account (Max plan). No raw `ANTHROPIC_API_KEY` is required for the agent itself. The mem0 memory layer makes separate LLM calls for memory extraction — configure those via `mem0/config.py`.

---

## How it works end-to-end

```
Slack message
     │
     ▼
slack-bridge.js (Socket Mode)
     │
     ├─► Whisper transcription (if voice message)
     │
     ▼
agent-worker.js
     │
     ├─► salvage-memory-search (retrieve relevant context)
     ├─► salvage-memory-read (load core operational memory)
     │
     ▼
Claude Code (OpenClaw harness)
     │
     ├─► salvage-tools (MCP tool calls, rate-limited via slot system)
     ├─► salvage-spawn (sub-agents for parallel work)
     │
     ▼
Response posted to Slack
     │
     └─► salvage-memory-update (persist new facts, instructions, commitments)
```

Background: `salvage-task-poller` runs every 60 seconds, promoting queued MCP slots and executing autonomous tasks that don't require a live Slack trigger.

---

## Documentation

| Doc | Description |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full system architecture and data flows |
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Step-by-step setup guide |
| [docs/MEMORY.md](docs/MEMORY.md) | Memory system deep-dive |
| [docs/MCP-CONCURRENCY.md](docs/MCP-CONCURRENCY.md) | MCP slot system and concurrency control |
| [docs/TASK-QUEUE.md](docs/TASK-QUEUE.md) | Autonomous task queue |
| [docs/SERVICES.md](docs/SERVICES.md) | macOS LaunchAgent services |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

---

## Philosophy

**Research first. Build for scale. Settle for nothing less than the best.**

Before any component was written, the top open-source projects in that space were studied — how they handle memory, how they queue tasks, how they recover from failure, where they fall short. openSalvage is the synthesis of that research, not a shortcut past it.

The salvage concept is not about taking whatever is convenient. It is about identifying what is genuinely best-in-class across the ecosystem — the memory architecture from mem0, the state machine durability from SwarmClaw, the agent loop patterns from LangGraph — and integrating them at a level of quality that matches or exceeds each source.

This means:
- **Scalability over simplicity.** Every design decision is made with growth in mind — concurrent task execution, slot-based rate control, durable queues, service supervision. The system is built to handle more, not just enough.
- **Quality over speed.** Components are researched thoroughly before they are built. If a better pattern exists somewhere in open source, it gets found and incorporated.
- **Production-grade from day one.** openSalvage started as a live production system, not a prototype. Durability, crash recovery, and operational visibility are not afterthoughts.
- **Local-first where it matters.** Embeddings and memory stay on your machine. Data sovereignty is not a feature to be added later.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT
