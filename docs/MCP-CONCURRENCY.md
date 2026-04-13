# MCP Concurrency Control

openSalvage's MCP concurrency system was built to solve a real production problem: unconstrained parallel `claude` subprocess spawning causes 100+ zombie processes when the Anthropic API rate-limits mid-execution. This document explains why it exists, how it works, and how to operate it.

---

## The Problem

Every time the agent calls an external tool (Notion, Slack, n8n, Instagram, etc.), `salvage-tools` spawns a new `claude` subprocess with MCP servers loaded. Without concurrency control, a busy agent can fire 10-20 of these simultaneously.

Under API rate limiting, these processes stall waiting for token quotas. They don't die — they block indefinitely. The result is dozens of zombie `claude` processes consuming RAM, file descriptors, and Ollama connections, eventually degrading or crashing the entire system.

The MCP slot system caps concurrent tool executions at 5. Everything beyond that queues and waits.

---

## The `mcp_slots` Table

All concurrency state lives in SQLite at `~/clawd/sessions/agent.db`.

```sql
CREATE TABLE mcp_slots (
  id           TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK(status IN ('queued','running','done','failed')),
  claimed_by   INTEGER,    -- PID of the owning salvage-tools process
  instruction  TEXT,       -- first 200 chars of the tool instruction
  workspace    TEXT,
  result       TEXT,       -- JSON result from the tool call
  error        TEXT,
  queued_at    TEXT DEFAULT (datetime('now')),
  started_at   TEXT,
  completed_at TEXT
);

CREATE INDEX idx_mcp_slots_status ON mcp_slots(status, queued_at);
```

Status transitions:

```
                ┌──────────────────────────────────────────┐
                │                                          │
         mcp-claim                                   mcp-recover
          (live)                                    (dead PID)
                │                                          │
                ▼                                          │
           [queued] ──── mcp-next (poller) ──────► [running] ──── mcp-done ──► [done]
                                                       │
                                                  mcp-failed ──► [failed]
```

---

## `BEGIN IMMEDIATE` + CTE Atomicity

The claim operation uses SQLite's `BEGIN IMMEDIATE` transaction to serialize all writers, combined with a CTE that evaluates capacity once and uses the result in all three inserted columns:

```sql
PRAGMA busy_timeout=5000;
BEGIN IMMEDIATE;
WITH capacity AS (
  SELECT COUNT(*) < 5 AS ok FROM mcp_slots WHERE status='running'
)
INSERT INTO mcp_slots (id, status, claimed_by, instruction, workspace, started_at)
SELECT
  '<new-uuid>',
  CASE WHEN ok THEN 'running' ELSE 'queued' END,
  CASE WHEN ok THEN <pid>     ELSE NULL     END,
  '<instruction>',
  '<workspace>',
  CASE WHEN ok THEN datetime('now') ELSE NULL END
FROM capacity;
COMMIT;
SELECT status || '|' || id FROM mcp_slots WHERE id='<new-uuid>';
```

This is atomic. Two concurrent `salvage-tools` processes cannot both see `COUNT(*) < 5` and both insert as `running` if only one slot is available. One wins, one queues.

The CTE is evaluated once per transaction, so all three `CASE WHEN ok` branches see the same capacity answer. There's no TOCTOU race between the count and the insert.

`busy_timeout=5000` means SQLite will retry the lock for up to 5 seconds before failing — enough headroom for any realistic burst of concurrent claims.

---

## Two-Tier Flow

### Tier 1: Live Claim (running)

When `salvage-tools` is invoked:

1. Run `mcp-recover` to release slots from dead processes (outside the transaction, to reduce lock contention)
2. Execute the `BEGIN IMMEDIATE` + CTE claim
3. If result is `running`:
   - Set `SALVAGE_SLOT_ID=<id>` in env
   - Spawn `salvage` with `--mcp` (all MCP servers loaded)
   - Stream output to caller
   - On completion: call `salvage-db mcp-done <id> <result>`
   - Exit 0 with the tool result

### Tier 2: Queue (queued)

If result is `queued`:

1. Print a structured JSON response to stdout:
   ```json
   {
     "status": "queued",
     "slot_id": "<uuid>",
     "message": "MCP tool queued (5 slots in use). The poller will execute this within 60 seconds.",
     "instruction": "<first 200 chars>"
   }
   ```
2. Touch `~/.salvage/dispatch-signal` to wake the poller immediately
3. Exit 0 (not an error — the caller should handle the queued response)

The agent receives the queued JSON and can either:
- Inform the user that the tool is queued and will complete shortly
- Poll `salvage-db mcp-result <slot_id>` for the result
- Continue with other work and check back later

---

## Dispatch-Signal File Wake Mechanism

The task poller runs on a 60-second heartbeat. Under normal conditions this is fine. But when a tool is queued due to slot contention, 60 seconds of additional latency is unacceptable.

To avoid this, `salvage-tools` touches `~/.salvage/dispatch-signal` immediately when it queues a slot:

```bash
touch ~/.salvage/dispatch-signal
```

The task poller checks for this file at the start of each cycle:

```bash
if [ -f "$SIGNAL_FILE" ]; then
  rm -f "$SIGNAL_FILE"
  log "Signal received — promoting queued MCP slots immediately"
fi
```

If the signal file exists, the poller runs immediately regardless of its timer. This brings queued slot promotion latency from ~60 seconds down to ~1-2 seconds in practice.

---

## Poller Promotion Logic

The task poller promotes queued slots via `salvage-db mcp-next`:

```bash
MAX_DISPATCH_PER_CYCLE=2
DISPATCHED=0

while [ "$DISPATCHED" -lt "$MAX_DISPATCH_PER_CYCLE" ]; do
  NEXT=$(salvage-db mcp-next $$)
  # mcp-next: atomically promotes oldest queued slot → running (if capacity allows)
  # Returns JSON with slot_id and instruction, or empty if nothing to promote
  
  [ -z "$NEXT" ] && break
  
  SLOT_ID=$(echo "$NEXT" | node -e "...")
  INSTRUCTION=$(echo "$NEXT" | node -e "...")
  
  SALVAGE_FROM_POLLER=1 SALVAGE_SLOT_ID=$SLOT_ID \
    salvage-tools ~/clawd "$INSTRUCTION" &
  
  DISPATCHED=$((DISPATCHED + 1))
done
```

`MAX_DISPATCH_PER_CYCLE=2` means the poller promotes at most 2 queued slots per 60-second cycle. This prevents a burst of queued slots from overwhelming the system all at once.

`mcp-next` uses the same `BEGIN IMMEDIATE` atomicity as `mcp-claim`. It will not promote a slot if doing so would exceed the 5-running cap.

When spawned by the poller (`SALVAGE_FROM_POLLER=1`), `salvage-tools` skips the `mcp-claim` step entirely — the poller already claimed the slot via `mcp-next`.

---

## Dead PID Recovery

When a `salvage-tools` process is killed by SIGKILL, OOM killer, or system crash, its slot stays in `running` state forever — blocking future claims. `mcp-recover` fixes this:

```bash
salvage-db mcp-recover
```

For each slot with `status='running'`:
1. Read `claimed_by` (the PID that claimed the slot)
2. Run `kill -0 $pid` — this checks if the process exists without sending a signal
3. If the PID is dead (or `claimed_by` is NULL): reset the slot to `queued`

```bash
# Core logic in salvage-db
rows=$(sql_raw "SELECT id || ' ' || COALESCE(claimed_by,'') FROM mcp_slots WHERE status='running';")
while IFS=' ' read -r slot_id slot_pid; do
  if [ -z "$slot_pid" ] || ! kill -0 "$slot_pid" 2>/dev/null; then
    sql_raw "UPDATE mcp_slots SET status='queued', claimed_by=NULL, started_at=NULL
             WHERE id='$slot_id';"
  fi
done <<< "$rows"
```

`mcp-recover` runs:
- At the start of every `salvage-tools` invocation (before claiming a slot)
- At the start of every poller cycle (before promoting queued slots)

This means dead slots are cleaned up continuously, not just at scheduled intervals.

---

## Checking Slot Status

```bash
# List all slots
salvage-db mcp-list

# Filter by status
salvage-db mcp-list running
salvage-db mcp-list queued
salvage-db mcp-list done
salvage-db mcp-list failed

# Read the result of a specific slot
salvage-db mcp-result <slot_id>

# Manually recover dead PIDs
salvage-db mcp-recover

# Overall stats
salvage-db stats
```

Example output of `salvage-db mcp-list running`:
```json
[
  {
    "id": "a3f2c1d0-...",
    "status": "running",
    "claimed_by": 12345,
    "instruction": "Read the Notion page for RENPHO project status",
    "workspace": "/Users/jayden.csai/clawd",
    "started_at": "2026-04-13 09:12:05"
  }
]
```

---

## What a "Queued" Response Means

When `salvage-tools` returns a queued response, the tool call has not executed yet. The agent should:

1. **Tell the user** that the tool is queued and will complete soon (within 60 seconds, usually within 2-3 seconds due to signal wake)
2. **Not retry immediately** — retrying would create another queued slot and double the work
3. **Optionally poll** for the result using `salvage-db mcp-result <slot_id>`

The queued state is not an error. It's backpressure. The system will drain the queue automatically.

If slots stay in `queued` for more than 5 minutes, something is wrong — either the poller isn't running, or all 5 running slots are stuck on dead PIDs. Run `salvage-db mcp-recover` to unblock.

---

## Tuning

The slot cap is set in `bin/salvage-tools` as:

```javascript
const MCP_MAX_SLOTS = parseInt(process.env.MCP_MAX_SLOTS || '5');
```

Override via environment variable:
```bash
MCP_MAX_SLOTS=3 salvage-tools ~/clawd "instruction"
```

`MAX_DISPATCH_PER_CYCLE` is set in `bin/salvage-task-poller`:
```bash
MAX_DISPATCH_PER_CYCLE=2
```

Increasing this allows the poller to drain the queue faster but risks temporarily exceeding the slot cap if multiple slots complete simultaneously between poll cycles. 2 is a safe default.
