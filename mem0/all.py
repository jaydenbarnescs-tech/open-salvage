#!/usr/bin/env python3
"""
all.py — Return all Vanessa memories formatted for prompt injection.

Usage: python all.py
Prints a formatted text block grouped by category, ready to inject into Vanessa's prompt.
"""
import sys
import os
import signal
from collections import defaultdict
from datetime import datetime, timezone, timedelta

TIMEOUT_SECONDS = 30

# Fix 3: Only surface memories from the last 90 days
MEMORY_MAX_AGE_DAYS = 90

CATEGORY_HEADERS = {
    "instruction":  "## Standing Instructions",
    "preference":   "## User Preferences",
    "commitment":   "## Active Commitments",
    "state":        "## Current System State",
}

# Display order
CATEGORY_ORDER = ["instruction", "preference", "commitment", "state"]

def timeout_handler(signum, frame):
    sys.stderr.write("ERROR: all.py timed out\n")
    sys.exit(1)

def main():
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(TIMEOUT_SECONDS)

    try:
        sys.path.insert(0, os.path.dirname(__file__))
        from config import get_memory, AGENT_ID

        m = get_memory()
        result = m.get_all(agent_id=AGENT_ID)
        signal.alarm(0)

        memories = result.get("results", []) if isinstance(result, dict) else []

        # Fix 3: Filter out entries older than 90 days
        cutoff = datetime.now(timezone.utc) - timedelta(days=MEMORY_MAX_AGE_DAYS)
        filtered = []
        for mem in memories:
            # Check created_at / last_referenced_at
            age_ok = True
            for field in ("last_referenced_at", "created_at"):
                val = mem.get(field) or (mem.get("metadata") or {}).get(field)
                if val:
                    try:
                        if isinstance(val, str):
                            # Handle both "2025-01-01T00:00:00Z" and "2025-01-01T00:00:00+00:00"
                            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                        elif isinstance(val, (int, float)):
                            dt = datetime.fromtimestamp(val, tz=timezone.utc)
                        else:
                            dt = None
                        if dt and dt < cutoff:
                            age_ok = False
                        break  # Only check the first field found
                    except Exception:
                        pass
            if age_ok:
                filtered.append(mem)
        memories = filtered

        if not memories:
            print("# Vanessa Core Memory\n\n(no memories stored yet)", flush=True)
            sys.exit(0)

        # Group by category
        by_category = defaultdict(list)
        for mem in memories:
            cat = (mem.get("metadata") or {}).get("category", "state")
            by_category[cat].append(mem.get("memory", ""))

        lines = ["# Vanessa Core Memory", ""]
        lines.append("This block is injected into every prompt. Always read it before responding.")
        lines.append("")
        lines.append("---")

        for cat in CATEGORY_ORDER:
            header = CATEGORY_HEADERS.get(cat, f"## {cat.title()}")
            lines.append("")
            lines.append(header)
            items = by_category.get(cat, [])
            if items:
                for item in items:
                    lines.append(f"- {item}")
            else:
                lines.append("(none)")

        # Any uncategorized entries not in the standard list
        for cat, items in by_category.items():
            if cat not in CATEGORY_ORDER:
                lines.append("")
                lines.append(f"## {cat.title()}")
                for item in items:
                    lines.append(f"- {item}")

        print("\n".join(lines), flush=True)
        sys.exit(0)

    except Exception as e:
        signal.alarm(0)
        sys.stderr.write(f"ERROR: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
