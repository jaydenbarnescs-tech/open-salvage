# Quickstart

Get openSalvage running from zero. This covers a fresh macOS machine. Budget 20-30 minutes for the full setup.

---

## Prerequisites

Before you start, install these:

**Claude Code CLI (OpenClaw harness)**
```bash
npm install -g @anthropic-ai/claude-code
```
You need a Claude Code subscription (Max plan recommended — the Claude API proxy routes all agent LLM calls through your Max plan auth, so you're not billed per-token on top of the subscription).

**Node.js 20+**
```bash
brew install node
node --version  # should be v20.x or higher
```

**Python 3.11+**
```bash
brew install python@3.11
python3 --version
```

**Ollama** — runs local embedding models (no API key required)
```bash
brew install ollama
brew services start ollama
```

Pull the required embedding models:
```bash
ollama pull qwen3-embedding:0.6b   # mem0 layer — 1024 dims, 600MB
ollama pull bge-m3                 # memory index layer — 1024 dims, 1.2GB
```

**SQLite3** (usually pre-installed on macOS)
```bash
sqlite3 --version
```

**macOS** — the service layer uses LaunchAgents. Linux support is not implemented.

---

## Clone and Install

```bash
# Clone into ~/clawd (the workspace the harness expects)
git clone https://github.com/your-org/openSalvage ~/clawd

cd ~/clawd

# Run the bootstrap installer
bash install.sh
```

`install.sh` does the following:
1. Creates `~/bin/` symlinks for all `salvage-*` scripts
2. Copies LaunchAgent plists to `~/Library/LaunchAgents/`
3. Loads core services (task-poller, watchdog, memory indexer)
4. Installs `claude-agent/` npm dependencies
5. Creates `~/.salvage/` config skeleton

Check it worked:
```bash
which salvage-db       # → ~/bin/salvage-db
salvage-db stats       # → should show empty table counts
launchctl list | grep salvage  # → running services
```

---

## Configure

### 1. MCP Tool Config

Edit `~/.salvage/mcp-config.json`. This was created by `install.sh` from the example. Fill in your secrets:

```bash
nano ~/.salvage/mcp-config.json
```

Required fields:
- `SLACK_BOT_TOKEN` — Slack bot token (`xoxb-...`) from your Slack app
- `SLACK_APP_TOKEN` — Slack app-level token (`xapp-...`) for Socket Mode
- Any other MCP server credentials (Notion token, n8n API key, etc.)

### 2. Agent Config

```bash
nano ~/.salvage/config.json
```

Key fields:
- `workspace` — path to your workspace (default: `~/clawd`)
- `agent_id` — identifier used in SQLite records (default: `vanessa`)
- `model` — Claude model to use (default: `claude-sonnet-4-6`)
- `proxy_url` — Claude API proxy URL for LLM calls

### 3. mem0 Python Environment

The mem0 memory layer runs in a dedicated Python virtualenv:

```bash
cd ~/clawd/claude-agent

# Create the virtualenv
python3.11 -m venv mem0-env

# Activate and install
source mem0-env/bin/activate
pip install -r ../mem0/requirements.txt

# Verify
python -c "from mem0 import Memory; print('mem0 ok')"
```

Verify the full mem0 stack (requires Ollama running):
```bash
cd ~/clawd/mem0
python search.py "test query"
# Should return: []
```

### 4. Slack App Setup

If you haven't set up the Slack app yet:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch
2. Enable **Socket Mode** (Event Subscriptions → Enable Socket Mode)
3. Under **OAuth & Permissions**, add these bot token scopes:
   - `channels:history`, `channels:read`
   - `chat:write`, `files:read`
   - `users:read`
4. Subscribe to **Events**: `message.channels`, `message.im`
5. Install app to your workspace
6. Copy `Bot User OAuth Token` (`xoxb-...`) → `SLACK_BOT_TOKEN` in mcp-config.json
7. Copy `App-Level Token` (`xapp-...`) → `SLACK_APP_TOKEN` in mcp-config.json

---

## Initialize the Database

```bash
salvage-db init
salvage-db stats
```

Expected output:
```
tasks:          0 rows
message_outbox: 0 rows
mcp_slots:      0 rows
runs:           0 rows
```

---

## Start Services

The core services should already be loaded by `install.sh`. Verify:

```bash
launchctl list | grep -E "salvage|vanessa|openclaw"
```

If any service is missing:
```bash
# Load individual service
launchctl load ~/Library/LaunchAgents/com.opensalvage.salvage-task-poller.plist
launchctl load ~/Library/LaunchAgents/com.opensalvage.salvage-watchdog.plist
launchctl load ~/Library/LaunchAgents/com.opensalvage.salvage-memory.plist
```

Start the Slack bridge and worker (if you want Slack integration):
```bash
launchctl load ~/Library/LaunchAgents/com.mgc.vanessa-worker.plist
launchctl load ~/Library/LaunchAgents/com.mgc.vanessa-slack-tunnel.plist
```

Check the task poller is healthy:
```bash
tail -f ~/claude-agent/logs/task-poller.log
# Should see a line every 60 seconds: "MCP recover done. Checking pending tasks..."
```

---

## Test with First Message

### Option A: CLI (no Slack required)

```bash
salvage --workspace ~/clawd -p "hello, what can you do?" --model claude-sonnet-4-6 --max-turns 5
```

You should see Claude respond via the CLI.

### Option B: With MCP tools

```bash
# Run a tool call through the concurrency system
salvage-tools ~/clawd "List your current task queue status"

# Check the slot was created and completed
salvage-db mcp-list done
```

### Option C: Full Slack pipeline

1. Invite your bot to a Slack channel
2. Send it a message: `@YourBot hello`
3. Watch the logs:
   ```bash
   tail -f ~/claude-agent/logs/vanessa-worker.log
   ```
4. The bot should respond in Slack within a few seconds

---

## Verify Memory is Working

Trigger a memory index build:
```bash
salvage-memory-index ~/clawd
```

Search the index:
```bash
salvage-memory-search ~/clawd "agent configuration"
```

Check mem0:
```bash
salvage-memory-read
```

---

## Common Issues

**`salvage-db` not found**
```bash
echo $PATH  # ensure ~/bin is in your PATH
export PATH="$HOME/bin:$PATH"
# Add to ~/.zshrc to make permanent
```

**Ollama not running**
```bash
brew services start ollama
curl http://localhost:11434/api/tags  # should list models
```

**mem0 timeout / embedding errors**
- Check Ollama is running and `qwen3-embedding:0.6b` is pulled
- Run `ollama ps` to see loaded models
- mem0 uses a 30-second timeout; if Ollama is slow to load, first call may time out but subsequent calls succeed

**LaunchAgent not loading**
```bash
# Check for plist syntax errors
plutil ~/Library/LaunchAgents/com.opensalvage.salvage-task-poller.plist

# Check the error log
cat ~/claude-agent/logs/task-poller.error.log
```

**Slack bridge not connecting**
- Verify `SLACK_APP_TOKEN` starts with `xapp-` and Socket Mode is enabled in your Slack app
- Check: `tail -f ~/claude-agent/logs/slack-bridge.log`

---

## Next Steps

- Read [ARCHITECTURE.md](../ARCHITECTURE.md) to understand how the system fits together
- Read [docs/MEMORY.md](MEMORY.md) to understand the dual memory system
- Read [docs/MCP-CONCURRENCY.md](MCP-CONCURRENCY.md) to understand tool execution
- Read [docs/SERVICES.md](SERVICES.md) for service management
- Read [CONTRIBUTING.md](../CONTRIBUTING.md) before making changes
