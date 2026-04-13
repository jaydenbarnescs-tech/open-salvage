#!/usr/bin/env python3
"""
add.py — Add a memory to Vanessa's Mem0 store.

Usage: python add.py "<content>" "<category>"
  category: instruction | preference | commitment | state

Exits 0 on success, prints "OK: <mem0_memory_id>"
Exits 1 on failure, prints "ERROR: <reason>"
"""
import sys
import os
import signal
import time
import subprocess
from pathlib import Path

TIMEOUT_SECONDS = 60

VALID_CATEGORIES = {"instruction", "preference", "commitment", "state"}

# Fix 2: Write lock file path
LOCK_FILE = Path.home() / "clawd/sessions/mem0-write.lock"
LOCK_MAX_AGE_SECONDS = 10
LOCK_TTL_SECONDS = 8

# Fix 2: Deduplication similarity threshold
DEDUP_SIMILARITY_THRESHOLD = 0.95

def timeout_handler(signum, frame):
    print("ERROR: Mem0 call timed out after {}s".format(TIMEOUT_SECONDS), flush=True)
    sys.exit(1)


def check_write_lock():
    """
    Returns True if a recent write lock exists (< LOCK_MAX_AGE_SECONDS old) — caller should skip.
    Deletes stale lock files (>= LOCK_MAX_AGE_SECONDS old).
    """
    if not LOCK_FILE.exists():
        return False
    try:
        age = time.time() - LOCK_FILE.stat().st_mtime
        if age < LOCK_MAX_AGE_SECONDS:
            return True  # fresh lock — skip write
        else:
            LOCK_FILE.unlink(missing_ok=True)  # stale — delete and proceed
            return False
    except Exception:
        return False


def set_write_lock():
    """Create the lock file and schedule its deletion after LOCK_TTL_SECONDS."""
    try:
        LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOCK_FILE.write_text(str(os.getpid()))
        # Background subprocess to delete lock after TTL
        subprocess.Popen(
            ["bash", "-c", f"sleep {LOCK_TTL_SECONDS} && rm -f {LOCK_FILE}"],
            close_fds=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def main():
    if len(sys.argv) < 3:
        print("ERROR: Usage: python add.py \"<content>\" \"<category>\"", flush=True)
        sys.exit(1)

    content  = sys.argv[1].strip()
    category = sys.argv[2].strip().lower()

    if not content:
        print("ERROR: content cannot be empty", flush=True)
        sys.exit(1)

    if category not in VALID_CATEGORIES:
        print(f"ERROR: Invalid category '{category}'. Must be one of: {', '.join(sorted(VALID_CATEGORIES))}", flush=True)
        sys.exit(1)

    # Fix 2: Check write lock BEFORE doing any expensive work
    if check_write_lock():
        print("OK: deduplicated (lock)", flush=True)
        sys.exit(0)

    # Set timeout to prevent hanging
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(TIMEOUT_SECONDS)

    try:
        # Import here (after arg validation) so startup errors surface cleanly
        sys.path.insert(0, os.path.dirname(__file__))
        from config import get_memory, AGENT_ID

        m = get_memory()

        # Fix 2: Fast FAISS deduplication check BEFORE calling memory.add()
        try:
            search_results = m.search(content, agent_id=AGENT_ID, limit=3)
            candidates = search_results.get("results", []) if isinstance(search_results, dict) else []
            for candidate in candidates:
                score = candidate.get("score", 0.0)
                if score >= DEDUP_SIMILARITY_THRESHOLD:
                    signal.alarm(0)
                    print("OK: deduplicated (fast-path)", flush=True)
                    sys.exit(0)
        except Exception as search_err:
            # Non-fatal: if search fails, proceed with the write
            sys.stderr.write(f"[add.py] WARNING: fast-path dedup search failed: {search_err}\n")

        result = m.add(
            content,
            agent_id=AGENT_ID,
            metadata={"category": category},
        )

        signal.alarm(0)  # cancel timeout

        # mem0 returns {"results": [{"id": ..., "memory": ..., "event": ...}]}
        # or {"results": []} on deduplication (no new memory added)
        results = result.get("results", []) if isinstance(result, dict) else []

        has_add_or_update = any(r.get("event") in ("ADD", "UPDATE") for r in results)
        has_delete        = any(r.get("event") == "DELETE" for r in results)

        wrote_memory = False

        if has_delete and not has_add_or_update:
            # Mem0 v1.0 quirk: when a new fact directly contradicts an existing one,
            # the LLM deletes the old memory but doesn't ADD the new content.
            # Force-add the new content with infer=False so it gets stored.
            signal.alarm(TIMEOUT_SECONDS)
            force_result = m.add(
                content,
                agent_id=AGENT_ID,
                metadata={"category": category},
                infer=False,
            )
            signal.alarm(0)
            force_results = force_result.get("results", []) if isinstance(force_result, dict) else []
            if force_results:
                mem_id = force_results[0].get("id", "unknown")
                print(f"OK: {mem_id} (event=ADD,replaced_conflict)", flush=True)
                wrote_memory = True
            else:
                print("OK: conflict resolved (old deleted, new deduped)", flush=True)
        elif results:
            # May contain ADD, UPDATE, and/or DELETE events.
            # Report the ADD/UPDATE event if present; fall back to the first result.
            primary = next(
                (r for r in results if r.get("event") in ("ADD", "UPDATE")),
                results[0],
            )
            mem_id = primary.get("id", "unknown")
            event  = primary.get("event", "ADD")
            print(f"OK: {mem_id} (event={event})", flush=True)
            if primary.get("event") in ("ADD", "UPDATE"):
                wrote_memory = True
        else:
            # Deduplicated — Mem0 decided no new memory was needed
            print("OK: deduplicated (no new memory created)", flush=True)

        # Fix 2: Set write lock after successful write to prevent rapid-fire duplicates
        if wrote_memory:
            set_write_lock()

            # Fix 3: Hard cap at 50 entries — evict oldest if exceeded
            try:
                all_result = m.get_all(agent_id=AGENT_ID)
                all_memories = all_result.get("results", []) if isinstance(all_result, dict) else []
                count = len(all_memories)
                if count > 50:
                    # Sort by created_at ascending (oldest first); fall back to index order
                    def get_created_at(mem):
                        return mem.get("created_at") or mem.get("metadata", {}).get("created_at") or ""
                    sorted_mems = sorted(all_memories, key=get_created_at)
                    oldest = sorted_mems[0]
                    oldest_id = oldest.get("id")
                    if oldest_id:
                        m.delete(oldest_id)
                        sys.stderr.write(f"[mem0] evicted oldest memory (count was {count})\n")
            except Exception as evict_err:
                sys.stderr.write(f"[mem0] WARNING: eviction check failed: {evict_err}\n")

        sys.exit(0)

    except Exception as e:
        signal.alarm(0)
        print(f"ERROR: {e}", flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
