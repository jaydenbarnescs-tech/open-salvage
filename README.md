# openSalvage

> Loot the best from open source. Run it all yourself.

openSalvage is a self-hosted AI agent framework built on top of [Claude Code](https://github.com/anthropics/claude-code) (OpenClaw harness). It does not try to reinvent anything. Instead it finds the best patterns from across the open-source AI landscape — memory systems, task queues, concurrency controls, tool execution — and assembles them into a single coherent system that runs on your own machine.

The name is literal. You go through what already exists, take what works, and put it on yourself.

---

## What it assembles

| Source | What was taken |
|---|---|
| [mem0](https://github.com/mem0ai/mem0) | FAISS semantic memory with category-based extraction |
| [LangGraph](https://github.com/langchain-ai/langgraph) | Two-phase execute-then-respond agent loop |
| AutoGPT patterns | Autonomous background task queue with poller daemon |
| SwarmClaw | SQLite durable state machine for task and slot tracking |
| OpenClaw / Claude Code | The agent harness, skill system, and MCP tool calling |
| [Ollama](https://ollama.ai) | Local embeddings (qwen3-embedding:0.6b, bge-m3) without sending data to third parties |

The result is a production-grade agent system that has been running continuously in a real business — handling Slack messages, executing autonomous tasks, managing memory across sessions, and coordinating parallel work — without hitting the 100+ zombie-process issues that come from naive Claude API usage.

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
- [Claude Code CLI](https://docs.anthropic.com/claude-code) with OpenClaw installed
- Node.js 20+
- Python 3.11+
- [Ollama](https://ollama.ai) running locally (for embeddings)
- SQLite3
- A Claude API key
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
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Slack app-level token (`xapp-...`) for Socket Mode |
| `OLLAMA_BASE_URL` | Ollama endpoint (default: `http://localhost:11434`) |
| `MCP_PROXY_URL` | Optional MCP proxy for remote tool access |

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

**Take what works. Drop what doesn't. Ship something real.**

Most AI agent frameworks are designed to be frameworks — abstractions, interfaces, plugin systems. openSalvage is designed to run. It started as a production system for a real business and was open-sourced afterward, not the other way around.

This means:
- **No speculative abstractions.** If a pattern exists in one place, it stays in one place until there's a real reason to generalise it.
- **SQLite over external services.** Every critical state — task queue, memory slots, message outbox, run history — lives in a local SQLite file. No Redis, no RabbitMQ, no external dependencies for state.
- **Local embeddings.** Ollama handles all embedding calls. Your documents and memories don't leave your machine.
- **Scripts over frameworks.** Most of `bin/` is bash and Node.js. You can read the whole thing in an afternoon.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT
