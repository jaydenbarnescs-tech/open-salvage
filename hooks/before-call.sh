#!/bin/bash
# before-call hook — inject yesterday's summary into the system prompt on new sessions
# This runs before every mechatron call for the clawd workspace

WORKSPACE="${MECHATRON_WORKSPACE:-$HOME/clawd}"
SESSION_KEY="${MECHATRON_SESSION_KEY:-}"
MEMORY_DIR="$WORKSPACE/memory"

# Only run context recovery if this looks like a new/reset session
# (The session state file tracks when sessions were last active)
STATE_FILE="$WORKSPACE/sessions/state.json"

if [ -z "$SESSION_KEY" ]; then
  exit 0  # no session, skip
fi

# Find yesterday and today's daily notes
TODAY=$(date '+%Y-%m-%d')
YESTERDAY=$(date -v -1d '+%Y-%m-%d' 2>/dev/null || date -d 'yesterday' '+%Y-%m-%d')

# If yesterday's note exists, create a brief summary file for context
YESTERDAY_NOTE="$MEMORY_DIR/$YESTERDAY.md"
if [ -f "$YESTERDAY_NOTE" ]; then
  # Write a compact summary to a temp location that mechatron can read
  SUMMARY_FILE="$WORKSPACE/sessions/.last-session-summary.md"
  {
    echo "# Yesterday's Activity ($YESTERDAY)"
    echo ""
    # Get last 10 entries from yesterday
    tail -10 "$YESTERDAY_NOTE"
    echo ""
    # Also get today's entries if they exist
    if [ -f "$MEMORY_DIR/$TODAY.md" ]; then
      echo "# Today's Activity So Far ($TODAY)"
      echo ""
      tail -10 "$MEMORY_DIR/$TODAY.md"
    fi
  } > "$SUMMARY_FILE"
fi

# Check if tasks.json has pending tasks
TASKS_FILE="$WORKSPACE/memory/tasks.json"
if [ -f "$TASKS_FILE" ]; then
  PENDING=$(cat "$TASKS_FILE" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  tasks=[t for t in d.get('tasks',[]) if t.get('status')!='done']
  for t in tasks[:5]:
    print(f\"- [{t.get('status','?')}] {t.get('title','?')}\")
except: pass
" 2>/dev/null)
  if [ -n "$PENDING" ]; then
    echo "" >> "$WORKSPACE/sessions/.last-session-summary.md"
    echo "# Pending Tasks" >> "$WORKSPACE/sessions/.last-session-summary.md"
    echo "" >> "$WORKSPACE/sessions/.last-session-summary.md"
    echo "$PENDING" >> "$WORKSPACE/sessions/.last-session-summary.md"
  fi
fi
