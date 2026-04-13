# Services

openSalvage runs as a set of macOS LaunchAgents. Each service has a specific responsibility, a dedicated log file, and a defined restart policy. The watchdog monitors the critical ones and auto-restarts on crash.

---

## Service List

### Core salvage Services

#### `com.opensalvage.salvage-task-poller`
**Script:** `~/bin/salvage-task-poller`  
**Interval:** Every 60 seconds (+ immediate wake on `~/.salvage/dispatch-signal`)  
**RunAtLoad:** No  
**Log:** `~/claude-agent/logs/task-poller.log`

The main background work loop. On each cycle:
1. Recovers stalled tasks (expired `visibility_timeout` → reset to `pending`)
2. Dispatches up to 2 pending tasks via `salvage`
3. Runs `mcp-recover` (dead PID cleanup on MCP slots)
4. Promotes up to 2 queued MCP slots to running via `salvage-tools`

This is the heartbeat of the autonomous agent. If this service is down, background tasks and queued MCP tool calls will stall.

---

#### `com.opensalvage.salvage-watchdog`
**Script:** `~/bin/salvage-watchdog`  
**Interval:** Every 300 seconds (5 minutes)  
**RunAtLoad:** Yes  
**Log:** `~/claude-agent/logs/watchdog.log`

Health monitor for all critical services. On each cycle:
- Checks each service via `launchctl list | grep <label>`
- If a service has exited with a non-zero code, attempts `launchctl kickstart`
- Enforces 10-minute cooldown between restarts of the same service
- Enforces max 10 restarts/hour across all services
- Sends a Slack DM alert when it cannot self-heal

Monitored services (hardcoded in `salvage-watchdog`):
- `com.opensalvage.salvage-task-poller`
- `com.mgc.vanessa-worker`
- Claude binary symlink (`/opt/homebrew/bin/claude`)

State is persisted to `~/.salvage/watchdog-state.json` between runs.

---

#### `com.opensalvage.salvage-memory`
**Script:** `~/claude-agent/salvage-memory.sh` (wraps `salvage-memory-index`)  
**Schedule:** Daily at midnight (`StartCalendarInterval Hour=0 Minute=0`)  
**RunAtLoad:** No  
**Log:** `~/claude-agent/logs/salvage-memory.log`

Re-indexes all workspace markdown files into the SQLite memory index (`~/clawd/sessions/memory.db`). Runs nightly to pick up any new files added to `memory/` during the day. Skips unchanged files via SHA hash comparison.

Run manually after adding memory files:
```bash
salvage-memory-index ~/clawd
```

---

### Agent Services

#### `com.mgc.vanessa-worker`
**Script:** `~/claude-agent/vanessa-worker.js`  
**KeepAlive:** Yes (always-on, restarts on exit)  
**ThrottleInterval:** 30 seconds (prevents rapid crash loops)  
**RunAtLoad:** Yes  
**Log:** `~/claude-agent/logs/worker.log`

The agent worker. Receives messages from the Slack bridge, builds Claude prompts with memory context, runs the tool loop, and posts responses back. The only always-on process in the stack.

`KeepAlive=true` means macOS restarts it immediately on exit. `ThrottleInterval=30` prevents restart storms if it's crash-looping. A PID lockfile in the worker itself prevents duplicate instances even across rapid restarts.

---

#### `com.mgc.vanessa-slack-tunnel`
**Script:** `~/claude-agent/slack-bridge.js` (Socket Mode Slack bot)  
**Log:** `~/claude-agent/logs/slack-bridge.log`

The Slack inbound gateway. Maintains a persistent WebSocket connection to Slack via Socket Mode. Routes incoming messages to the worker and posts responses. Handles voice transcription handoff to Whisper.

---

#### `com.mgc.vanessa-dispatcher`
**Script:** `~/claude-agent/dispatcher.js`  
**Log:** `~/claude-agent/logs/dispatcher.log`

Message dispatcher. Handles routing between channels, outbox delivery from `message_outbox`, and retry logic for failed Slack posts.

---

### Infrastructure Services

#### `com.mgc.whisper-proxy`
**Script:** `~/claude-agent/whisper-proxy.js`  
**Log:** `~/claude-agent/logs/whisper-proxy.log`

HTTP proxy for Whisper transcription. Receives audio from the Slack bridge, forwards to the Whisper server, returns transcript text.

#### `com.mgc.whisper-server`
**Log:** `~/claude-agent/logs/whisper-server.log`

Whisper model server for voice transcription. Processes audio from Slack voice messages.

#### `com.mgc.mac-proxy`
**Log:** `~/claude-agent/logs/mac-proxy.log`

The Claude API proxy. All Claude API calls from the agent worker and salvage-tools route through this proxy, which authenticates via the Claude Code Max plan session instead of a separate API key.

#### `ai.openclaw.gateway`
**Log:** per OpenClaw configuration

OpenClaw harness gateway. Routes Claude Code CLI sessions.

#### `com.mgc.caffeinate`
Prevents the Mac from sleeping while services are running.

---

### Cron Services

All cron services use `StartCalendarInterval` for schedule-based execution. They call `salvage` directly with a hardcoded prompt — no task queue involved.

#### `com.salvage.cron.linkedin-strategy`
**Schedule:** Daily at 07:00  
**Log:** `~/claude-agent/logs/cron-linkedin-strategy.log`

Runs the LinkedIn content skill in Mode 0: picks a strategy topic and drafts a 500-800 word long-form LinkedIn post.

#### `com.salvage.cron.linkedin-jayden-context`
**Log:** `~/claude-agent/logs/cron-linkedin-jayden-context.log`

Refreshes LinkedIn-specific context for the agent (recent posts, engagement data, strategy notes).

#### `com.salvage.cron.linkedin-web-scout`
**Log:** `~/claude-agent/logs/cron-linkedin-web-scout.log`

Scouts the web for content relevant to LinkedIn strategy (AI automation trends, industry news, competitor activity).

#### `com.salvage.cron.overseas-buyer-outreach`
**Log:** `~/claude-agent/logs/cron-overseas-buyer-outreach.log`

Automated outbound outreach for overseas buyer leads.

#### `com.salvage.cron.hourly-status`
**Schedule:** Top of every hour  
**Log:** `~/claude-agent/logs/cron-hourly-status.log`

Reads `memory/tasks.json` and today's daily note, then posts a status summary to the operator's Slack DM with a health indicator (✅/⚠️/🔴).

---

## How to Load and Unload Services

### Load a service
```bash
launchctl load ~/Library/LaunchAgents/<label>.plist
```

### Unload a service
```bash
launchctl unload ~/Library/LaunchAgents/<label>.plist
```

### Check if a service is running
```bash
launchctl list | grep <label>
# Output: <pid>  <exitcode>  <label>
# PID = '-' means not running
```

### Force-restart a running service
```bash
launchctl kickstart -k gui/$(id -u)/<label>
# -k kills the existing instance first
```

### Check service status interactively
```bash
# Shows PID, last exit code, and service info
launchctl print gui/$(id -u)/<label>
```

---

## Log Locations

All logs write to `~/claude-agent/logs/`:

| Service | Log File |
|---|---|
| salvage-task-poller | `task-poller.log` |
| salvage-watchdog | `watchdog.log` |
| salvage-memory | `salvage-memory.log` |
| vanessa-worker | `worker.log` |
| vanessa-slack-tunnel | `slack-bridge.log` |
| vanessa-dispatcher | `dispatcher.log` |
| whisper-proxy | `whisper-proxy.log` |
| whisper-server | `whisper-server.log` |
| mac-proxy | `mac-proxy.log` |
| cron-linkedin-strategy | `cron-linkedin-strategy.log` |
| cron-hourly-status | `cron-hourly-status.log` |
| cron-linkedin-web-scout | `cron-linkedin-web-scout.log` |
| cron-overseas-buyer-outreach | `cron-overseas-buyer-outreach.log` |

Both stdout and stderr go to the same log file for each service.

Tail logs in real time:
```bash
tail -f ~/claude-agent/logs/task-poller.log
tail -f ~/claude-agent/logs/worker.log
tail -f ~/claude-agent/logs/watchdog.log

# Follow multiple logs at once
tail -f ~/claude-agent/logs/task-poller.log ~/claude-agent/logs/worker.log
```

---

## How install.sh Sets Up Services

`install.sh` handles the full service setup:

```bash
# 1. Copy plists from repo to LaunchAgents directory
cp launchagents/com.opensalvage.salvage-task-poller.plist ~/Library/LaunchAgents/
cp launchagents/com.opensalvage.salvage-watchdog.plist ~/Library/LaunchAgents/
cp launchagents/com.opensalvage.salvage-memory.plist ~/Library/LaunchAgents/
# ... and all others

# 2. Patch HOME path in plists (if your username differs from default)
sed -i '' "s|/Users/jayden.csai|$HOME|g" ~/Library/LaunchAgents/*.plist

# 3. Load core services
launchctl load ~/Library/LaunchAgents/com.opensalvage.salvage-task-poller.plist
launchctl load ~/Library/LaunchAgents/com.opensalvage.salvage-watchdog.plist
launchctl load ~/Library/LaunchAgents/com.opensalvage.salvage-memory.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.gateway.plist
```

Not all services are auto-loaded by `install.sh`. The Slack bridge, worker, whisper services, and cron jobs are loaded separately after you've filled in the secrets in `~/.salvage/mcp-config.json`.

---

## Watchdog Behavior in Detail

The watchdog (`salvage-watchdog`) manages restart state in `~/.salvage/watchdog-state.json`:

```json
{
  "restarts": {
    "com.opensalvage.salvage-task-poller": {
      "count": 2,
      "lastRestart": "2026-04-13T09:15:00.000Z"
    }
  },
  "lastAlert": 1713000000000,
  "restartsThisHour": 2,
  "hourStart": 1713000000000
}
```

Restart rules:
- **Cooldown:** 10 minutes (`COOLDOWN_MS = 600000`) between restarts of the same service
- **Hourly cap:** 10 restarts across all services per hour (`MAX_RESTARTS_PER_HOUR = 10`)
- **Alert threshold:** If cooldown or hourly cap is hit, the watchdog sends a Slack DM instead of restarting

The watchdog also checks the Claude binary symlink. If `claude` is broken (missing, dangling symlink, or replaced), it alerts — because a broken Claude binary silently breaks all agent sessions.

---

## Adding a New Service

See the [CONTRIBUTING.md](../CONTRIBUTING.md) guide for the full process. The minimum steps:

1. Create a plist in `launchagents/` with the `com.opensalvage.*` or `com.mgc.*` namespace
2. Set `HOME` and `PATH` in `EnvironmentVariables`
3. Point logs to `~/claude-agent/logs/`
4. Add to `install.sh`
5. Add to watchdog monitoring if the service is critical
6. Document in this file
