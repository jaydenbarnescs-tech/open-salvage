#!/bin/bash
# mechatron-memory.sh — nightly memory consolidation
# Reads this week's daily notes and updates MEMORY.md

LOG=~/claude-agent/logs/mechatron-memory.log
MEMORY_DIR=~/.openclaw/workspace/memory
MEMORY_FILE=~/.openclaw/workspace/MEMORY.md
MECHATRON=~/bin/mechatron

# Fix 4: Prompt size limits
PROMPT_CHAR_CAP=15000
MAX_ENTRIES_PER_CATEGORY=30

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

log "=== Memory consolidation started ==="

# Collect daily notes from last 7 days
NOTES=""
for i in 0 1 2 3 4 5 6; do
  DATE=$(date -v -${i}d '+%Y-%m-%d' 2>/dev/null || date -d "$i days ago" '+%Y-%m-%d')
  FILE="$MEMORY_DIR/$DATE.md"
  if [ -f "$FILE" ]; then
    NOTES="$NOTES\n\n--- $DATE ---\n$(cat "$FILE")"
  fi
done

if [ -z "$NOTES" ]; then
  log "No daily notes found. Skipping."
  exit 0
fi

# Fix 4: Truncate MEMORY.md to 30 most recent entries per category
CURRENT_MEMORY=""
if [ -f "$MEMORY_FILE" ]; then
  # Use python to truncate entries per category to MAX_ENTRIES_PER_CATEGORY
  CURRENT_MEMORY=$(python3 - "$MEMORY_FILE" "$MAX_ENTRIES_PER_CATEGORY" <<'PYEOF'
import sys, re

fpath = sys.argv[1]
max_per_cat = int(sys.argv[2])

with open(fpath, 'r') as f:
    content = f.read()

# Split by section headers (## lines)
sections = re.split(r'(^## .+$)', content, flags=re.MULTILINE)
result_parts = []
total_truncated = 0

i = 0
while i < len(sections):
    part = sections[i]
    if part.startswith('## ') and i + 1 < len(sections):
        header = part
        body = sections[i + 1]
        # Extract bullet entries (lines starting with -)
        lines = body.split('\n')
        bullet_lines = [l for l in lines if l.strip().startswith('-')]
        non_bullet = [l for l in lines if not l.strip().startswith('-')]
        if len(bullet_lines) > max_per_cat:
            truncated = len(bullet_lines) - max_per_cat
            total_truncated += truncated
            bullet_lines = bullet_lines[-max_per_cat:]  # keep most recent (end of list)
        new_body = '\n'.join(non_bullet[:1] + bullet_lines + non_bullet[1:]) if non_bullet else '\n'.join(bullet_lines)
        result_parts.append(header + new_body)
        i += 2
    else:
        result_parts.append(part)
        i += 1

if total_truncated > 0:
    import sys as _sys
    _sys.stderr.write(f"[mechatron-memory] Truncated {total_truncated} old entries (keeping {max_per_cat} per category)\n")

print(''.join(result_parts), end='')
PYEOF
  )

  if [ $? -ne 0 ]; then
    log "WARNING: Failed to truncate memory file — using raw content"
    CURRENT_MEMORY=$(cat "$MEMORY_FILE")
  fi
fi

# Fix 4: Build prompt and check character count
PROMPT_BASE="You are consolidating Mechatron's memory.

Current MEMORY.md:
$CURRENT_MEMORY

Daily notes from the past 7 days:
$NOTES

Task: Update MEMORY.md to include any new facts, decisions, patterns, preferences, or insights worth remembering long-term. Rules:
- Do NOT duplicate what is already in MEMORY.md
- Keep it concise — distilled wisdom, not a log
- Remove entries that are no longer relevant
- Add new entries under appropriate sections
- Output the complete updated MEMORY.md content only — no explanation"

PROMPT_LEN=${#PROMPT_BASE}
log "Prompt length: $PROMPT_LEN chars"

if [ "$PROMPT_LEN" -gt "$PROMPT_CHAR_CAP" ]; then
  log "Prompt exceeds $PROMPT_CAP chars — using 2-pass consolidation"

  # Pass 1: Summarize CURRENT_MEMORY into a compact block
  PASS1_PROMPT="You are compacting a memory file. Summarize the following MEMORY.md into a compact block of at most 50 bullet points, preserving the most important facts, preferences, and standing instructions. Drop trivial or outdated entries. Output ONLY the summarized markdown — no explanation.

$CURRENT_MEMORY"

  log "Pass 1: Summarizing existing memory..."
  MEMORY_SUMMARY=$("$MECHATRON" --task general --no-live-state -p "$PASS1_PROMPT" --max-turns 3 2>>"$LOG")

  if [ $? -ne 0 ] || [ -z "$MEMORY_SUMMARY" ]; then
    log "Pass 1 failed — falling back to full prompt"
    MEMORY_SUMMARY="$CURRENT_MEMORY"
  else
    log "Pass 1 complete. Summary length: ${#MEMORY_SUMMARY} chars"
  fi

  # Pass 2: Consolidate with summary + new notes
  PROMPT="You are consolidating Mechatron's memory.

Summarized existing MEMORY.md (compacted from full version):
$MEMORY_SUMMARY

Daily notes from the past 7 days:
$NOTES

Task: Update MEMORY.md to include any new facts, decisions, patterns, preferences, or insights worth remembering long-term. Rules:
- Do NOT duplicate what is already in MEMORY.md
- Keep it concise — distilled wisdom, not a log
- Remove entries that are no longer relevant
- Add new entries under appropriate sections
- Output the complete updated MEMORY.md content only — no explanation"

  log "Pass 2: Consolidating with new notes..."
else
  PROMPT="$PROMPT_BASE"
fi

log "Calling mechatron for memory consolidation (max-turns=3)..."
RESULT=$("$MECHATRON" --task general --no-live-state -p "$PROMPT" --max-turns 3 2>>"$LOG")

if [ $? -eq 0 ] && [ -n "$RESULT" ]; then
  echo "$RESULT" > "$MEMORY_FILE"
  log "Memory updated successfully."
else
  log "Memory consolidation failed or returned empty result."
  exit 1
fi

log "=== Memory consolidation done ==="
