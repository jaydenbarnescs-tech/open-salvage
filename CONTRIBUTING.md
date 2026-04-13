# Contributing to openSalvage

openSalvage is production software. Every change runs on a live agent. Treat it accordingly.

---

## Philosophy

**Salvage the best.** Don't reinvent what already works. When a pattern exists in mem0, LangGraph, AutoGPT, SwarmClaw, or OpenClaw, steal it explicitly and attribute it in comments. The codebase is a curated collection of proven ideas, not original research.

**Keep it simple.** A bash script that does one thing reliably beats a framework that does ten things flakily. If you're adding abstraction, justify it with a concrete problem it solves.

**Production-first.** openSalvage runs continuously on a real workstation serving a real agent. There is no staging environment. If your change can crash the task poller or leave zombie processes, test it manually before merging.

**Operational visibility.** Every component logs to `~/claude-agent/logs/`. Every state transition goes through SQLite. If something breaks at 3am, the logs and database should tell the full story.

---

## Repository Layout

```
bin/                  — executable scripts (all named salvage-*)
claude-agent/         — Node.js agent worker, Slack bridge, memory scripts
  mem0/               — Python mem0 integration (FAISS + Ollama)
config/               — configuration files
docs/                 — technical documentation
hooks/                — git hooks
install.sh            — bootstrap installer
launchagents/         — macOS LaunchAgent plists
memory/               — workspace markdown files (indexed by salvage-memory-index)
sessions/             — runtime state (agent.db, mem0-store/, memory.db)
skills/               — reusable agent skill definitions
state/                — ephemeral runtime state files
```

---

## Adding a New Bin Script

Every command the agent or operator runs should be a `bin/salvage-*` script.

1. **Create the file** in `bin/` with a `salvage-` prefix:

   ```bash
   touch bin/salvage-my-command
   chmod +x bin/salvage-my-command
   ```

2. **Start with the standard header.** Copy the pattern from an existing script:

   ```bash
   #!/bin/bash
   # salvage-my-command — one-line description of what this does
   # Patterns from: <source framework if applicable>
   #
   # Usage:
   #   salvage-my-command <arg1> [arg2]

   set -euo pipefail

   HOME="${HOME:-/Users/jayden.csai}"
   LOG="$HOME/claude-agent/logs/my-command.log"

   log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }
   ```

3. **Use absolute paths.** Never rely on `PATH` being set. Reference `$HOME/bin/salvage-db`, `/usr/bin/sqlite3`, `/opt/homebrew/bin/node` explicitly.

4. **Write to the log.** Use the `log()` function for every significant action and error.

5. **Exit codes matter.** Exit 0 on success, non-zero on failure. The watchdog and poller check exit codes.

6. **Add it to the usage comment in `salvage-db`** if it interacts with the database.

7. **Document it** in `ARCHITECTURE.md` under the Subsystems section.

---

## Adding a New Skill

Skills are reusable agent capabilities stored in `skills/`. A skill is a markdown file that tells the agent how to perform a specific task category.

1. **Create the skill file:**

   ```
   skills/my-skill.md
   ```

2. **Structure it clearly.** The agent reads this at task time. Be explicit about:
   - What the skill is for
   - What inputs it expects
   - What tools it uses
   - What output it produces
   - Edge cases and failure modes

3. **Reference relevant tools.** If the skill uses MCP tools (Notion, Slack, n8n), name them exactly as they appear in the MCP server configuration.

4. **Test it manually.** Run `salvage --workspace ~/clawd -p "use the my-skill skill to do X"` and verify behavior before wiring it into automation.

5. **Register it** in `TOOLS.md` so the agent knows the skill exists.

---

## Adding a New LaunchAgent Service

If you're adding a new background process, it needs a LaunchAgent plist.

1. **Create the plist** in `launchagents/`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
     "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>com.opensalvage.salvage-my-service</string>
     <key>ProgramArguments</key>
     <array>
       <string>/Users/jayden.csai/bin/salvage-my-service</string>
     </array>
     <key>StartInterval</key>
     <integer>300</integer>
     <key>StandardOutPath</key>
     <string>/Users/jayden.csai/claude-agent/logs/my-service.log</string>
     <key>StandardErrorPath</key>
     <string>/Users/jayden.csai/claude-agent/logs/my-service.error.log</string>
     <key>EnvironmentVariables</key>
     <dict>
       <key>HOME</key>
       <string>/Users/jayden.csai</string>
       <key>PATH</key>
       <string>/Users/jayden.csai/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
     </dict>
     <key>RunAtLoad</key>
     <true/>
   </dict>
   </plist>
   ```

2. **Use `StartInterval` for polling daemons.** Use `StartCalendarInterval` for cron-style schedules.

3. **Always set `HOME` and `PATH`** in `EnvironmentVariables`. LaunchAgents run in a stripped environment.

4. **Wire it into `install.sh`.** The installer should `cp` the plist and `launchctl load` it.

5. **Add it to `salvage-watchdog`** if it's critical. The watchdog will auto-restart it on crash.

6. **Document it** in `docs/SERVICES.md`.

---

## PR Guidelines

- **One concern per PR.** Don't bundle a bug fix with a new feature.
- **Describe the problem, not just the change.** Why does this exist? What broke? What was missing?
- **Test manually before opening the PR.** Show the command you ran and the output.
- **Note if it touches SQLite schema.** Schema changes require `salvage-db init` to be re-run and may need migration logic.
- **Note if it touches LaunchAgents.** These need to be unloaded, updated, and reloaded.
- **Attribute pattern sources.** If you're adapting something from SwarmClaw, mem0, LangGraph, etc., say so in the code and the PR.

---

## Testing Approach

openSalvage doesn't have a test suite in the traditional sense. The system is tested by running it.

**For bin scripts:**
```bash
# Run the script directly and verify output
~/bin/salvage-my-command arg1

# Check the log
tail -f ~/claude-agent/logs/my-command.log

# Check database state
~/bin/salvage-db task list
~/bin/salvage-db mcp-list
~/bin/salvage-db stats
```

**For MCP tool changes:**
```bash
# Test a tool call manually via salvage-tools
~/bin/salvage-tools ~/clawd "your instruction here"

# Verify the slot was created and completed
~/bin/salvage-db mcp-list done
```

**For memory changes:**
```bash
# Trigger a re-index
~/bin/salvage-memory-index ~/clawd

# Test search
~/bin/salvage-memory-search ~/clawd "test query"

# Test mem0
cd ~/claude-agent/mem0 && python search.py "test query"
```

**For LaunchAgent changes:**
```bash
# Unload, update, reload
launchctl unload ~/Library/LaunchAgents/com.opensalvage.salvage-my-service.plist
cp launchagents/com.opensalvage.salvage-my-service.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.opensalvage.salvage-my-service.plist
launchctl list | grep salvage-my-service
```

**Smoke test the full pipeline:**
```bash
# Send a message through the Slack bridge and watch the logs
tail -f ~/claude-agent/logs/vanessa-worker.log ~/claude-agent/logs/task-poller.log
```

---

## Crash Recovery

If something goes wrong in production:

```bash
# Check all service statuses
launchctl list | grep -E "salvage|vanessa|whisper"

# Check for stalled tasks
~/bin/salvage-db stalled

# Recover stalled tasks manually
~/bin/salvage-backlog-recovery

# Check MCP slot status
~/bin/salvage-db mcp-list

# Recover dead-PID MCP slots
~/bin/salvage-db mcp-recover

# Restart the task poller
launchctl kickstart -k gui/$(id -u)/com.opensalvage.salvage-task-poller
```
