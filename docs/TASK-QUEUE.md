# Task Queue

The task queue is openSalvage's autonomous work system. Tasks are units of deferred work that the agent can create, claim, and execute independently of any live conversation. This is how the agent runs LinkedIn strategy jobs, outreach campaigns, background research, and other long-running workloads without blocking Slack responses.

The pattern comes from SwarmClaw's durable state machine: tasks persist in SQLite, survive process crashes, and are recovered automatically.

---

## Tasks Table Schema

```sql
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  status            TEXT DEFAULT 'pending'
                    CHECK(status IN
                      ('pending','claimed','running','done','failed','cancelled','handoff')),
  assigned_agent    TEXT,
  payload           TEXT DEFAULT '{}',  -- JSON
  result            TEXT,               -- JSON
  parent_task_id    TEXT REFERENCES tasks(id),
  source            TEXT,               -- who created this (e.g. 'slack', 'cron', 'manual')
  source_ref        TEXT,               -- external ID (e.g. Slack message ts)
  priority          INTEGER DEFAULT 0,  -- higher = picked up first
  retry_count       INTEGER DEFAULT 0,
  max_retries       INTEGER DEFAULT 3,
  visibility_timeout TEXT,              -- ISO datetime; task is reclaimable after this
  created_at        TEXT DEFAULT (datetime('now')),
  claimed_at        TEXT,
  completed_at      TEXT,
  error             TEXT
);

CREATE INDEX idx_tasks_status   ON tasks(status, type);
CREATE INDEX idx_tasks_agent    ON tasks(assigned_agent, status);
CREATE INDEX idx_tasks_timeout  ON tasks(visibility_timeout);
```

---

## Task Lifecycle

```
                  create
                    │
                    ▼
               [pending]
                    │
          salvage-db task claim
                    │
                    ▼
               [claimed]
                    │
             agent starts work
                    │
                    ▼
               [running]
                    │
          ┌─────────┴────────┐
          │                  │
       success            failure
          │                  │
          ▼                  ▼
        [done]           [failed]
                         (retry_count < max_retries → back to pending)

     [cancelled] — operator or agent explicitly cancelled
     [handoff]   — task handed off to a sub-agent (salvage-spawn)
```

### pending

Task is waiting to be picked up. The poller checks for pending tasks every 60 seconds. Tasks are ordered by `priority DESC, created_at ASC` — higher priority tasks go first; within the same priority, oldest first.

### claimed

Task has been atomically claimed by an agent. `assigned_agent`, `claimed_at`, and `visibility_timeout` are set. The `visibility_timeout` is 30 minutes from claim time.

The claim is atomic:
```sql
UPDATE tasks
SET status='claimed',
    assigned_agent='<agent>',
    claimed_at=datetime('now'),
    visibility_timeout=datetime('now', '+30 minutes')
WHERE id = (
  SELECT id FROM tasks
  WHERE status='pending'
    AND type IN (<types>)
    AND (visibility_timeout IS NULL OR visibility_timeout < datetime('now'))
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
)
RETURNING *;
```

If two agents race to claim the same task, only one wins — SQLite's row-level locking ensures this.

### running

The agent has started executing. The visibility timeout must be extended via heartbeat while work is in progress.

### done / failed

Terminal states. `result` (JSON) is stored on success. `error` (text) is stored on failure. `completed_at` is set.

If `retry_count < max_retries` on failure, the task is reset to `pending` for retry. If retries are exhausted, it stays `failed`.

### cancelled

Set by the operator or agent to stop processing. Not retried.

### handoff

Set when `salvage-spawn` creates a sub-agent to continue the work. The parent task enters handoff state; the child task carries the actual work.

---

## salvage-task-poller Behavior

The poller (`bin/salvage-task-poller`) runs every 60 seconds via LaunchAgent, plus immediately on `~/.salvage/dispatch-signal` touch.

Each cycle:

**Step 1: Recover stalled tasks**
```bash
salvage-db stalled   # find tasks where visibility_timeout < now() and status IN ('claimed','running')
# Reset them to 'pending'
```

**Step 2: Dispatch pending tasks**
```bash
PENDING=$(salvage-db task list pending)
# Slice to first 2 tasks
# For each task:
salvage \
  --workspace ~/clawd \
  --task "$TASK_TYPE" \
  --task-id "$TASK_ID" \
  --fresh \
  --no-mcp \
  -p "$PROMPT" \
  --model claude-sonnet-4-6 \
  --max-turns 15 \
  --dangerously-skip-permissions
```

`--no-mcp` is used for task processing because MCP tools are called via `salvage-tools` (which handles its own concurrency). Loading all MCP servers at task start would be wasteful for tasks that don't use them.

**Step 3: MCP slot promotion**

See [MCP-CONCURRENCY.md](MCP-CONCURRENCY.md) for the full MCP promotion flow.

---

## Creating Tasks Programmatically

### Via CLI

```bash
# Create a task
salvage-db task create research '{"description": "Research Komatsu Q1 2026 earnings", "output": "summary"}'

# Create with priority
salvage-db task create outreach '{"lead": "contact@example.com"}' slack '' 10

# List tasks
salvage-db task list
salvage-db task list pending
salvage-db task list running

# Check stats
salvage-db stats
```

### Via Agent

The agent can create tasks for deferred or background work using `salvage-db`:

```bash
salvage-db task create linkedin-post \
  '{"draft": "AI is transforming...", "scheduled_for": "2026-04-14T09:00:00Z"}' \
  vanessa-agent
```

### Via Cron

The `salvage-cron` runner creates tasks on a schedule. Each cron plist has a `StartCalendarInterval` that wakes `salvage-cron`, which invokes `salvage-db task create` with the appropriate type and payload.

Example cron job creating a task:
```bash
salvage-db task create web-scout \
  '{"query": "AI automation tools 2026", "output": "digest"}' \
  cron linkedin-web-scout
```

---

## Task Payload Convention

Payloads are free-form JSON. The `salvage-task-poller` extracts the agent prompt from the payload using this priority:

```javascript
payload.description || payload.instruction || payload.prompt || JSON.stringify(payload)
```

For well-formed tasks, include a `description` field:
```json
{
  "description": "Research the top 5 AI automation platforms and write a comparison doc",
  "output_path": "memory/research/ai-platforms.md",
  "max_sources": 10
}
```

---

## Visibility Timeouts and Heartbeats

The visibility timeout protects against tasks getting stuck if the agent crashes mid-execution.

**Initial timeout:** Set to `now() + 30 minutes` on claim.

**Heartbeat:** The agent extends the timeout every time it makes progress:
```bash
salvage-db task heartbeat <task_id>
# Sets visibility_timeout = now() + 30 minutes
```

The agent harness sends heartbeats automatically via the `--task-id` flag. Each tool call and major step resets the clock.

**Stalled detection:** If `visibility_timeout < now()` and status is `claimed` or `running`, the poller considers the task stalled. It resets status to `pending`, increments `retry_count`, and clears `assigned_agent`.

**Max retries:** If `retry_count >= max_retries` (default 3), the task is marked `failed` instead of being re-queued.

---

## Backlog Recovery

`salvage-backlog-recovery` is a manual recovery tool for when the normal stall recovery isn't enough:

```bash
~/bin/salvage-backlog-recovery
```

It does a more aggressive pass:
- Finds all tasks with `status IN ('claimed', 'running')` regardless of timeout
- Checks the assigned agent's PID (if available) with `kill -0`
- Resets dead tasks to `pending`
- Reports a summary of what was recovered

Run this after a system crash, reboot, or after force-killing the agent worker.

---

## Checking Task State

```bash
# All tasks
salvage-db task list

# By status
salvage-db task list pending
salvage-db task list running
salvage-db task list failed

# Full database stats
salvage-db stats

# Find stalled tasks
salvage-db stalled

# View runs for a task
sqlite3 ~/clawd/sessions/agent.db \
  "SELECT * FROM runs WHERE task_id='<id>' ORDER BY started_at DESC;"
```

---

## Task Types

Task types are free-form strings used to route tasks to the right agent prompt or skill. Current types in production:

| Type | Description |
|---|---|
| `research` | Web research and summarization |
| `linkedin-post` | Draft and schedule a LinkedIn post |
| `web-scout` | Scout the web for relevant content |
| `outreach` | Send outbound outreach messages |
| `linkedin-strategy` | Run LinkedIn strategy analysis |
| `general` | Catch-all for ad-hoc tasks from Slack |
| `memory-update` | Explicit memory consolidation task |

Add new types by creating tasks with that type string and building the corresponding skill or prompt to handle it.
