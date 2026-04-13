#!/usr/bin/env python3
"""
search.py — Search Vanessa's Mem0 store.

Usage: python search.py "<query>" [limit]
Prints JSON array of results to stdout.
"""
import sys
import os
import json
import signal

TIMEOUT_SECONDS = 30

def timeout_handler(signum, frame):
    print("[]", flush=True)
    sys.exit(0)

def main():
    if len(sys.argv) < 2:
        print("[]", flush=True)
        sys.exit(0)

    query = sys.argv[1].strip()
    limit = 10
    if len(sys.argv) >= 3:
        try:
            limit = int(sys.argv[2])
        except ValueError:
            pass

    if not query:
        print("[]", flush=True)
        sys.exit(0)

    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(TIMEOUT_SECONDS)

    try:
        sys.path.insert(0, os.path.dirname(__file__))
        from config import get_memory, AGENT_ID

        m = get_memory()
        result = m.search(query, agent_id=AGENT_ID, limit=limit)
        signal.alarm(0)

        results = result.get("results", []) if isinstance(result, dict) else []
        output = []
        for r in results:
            output.append({
                "id":       r.get("id"),
                "memory":   r.get("memory"),
                "score":    r.get("score"),
                "category": (r.get("metadata") or {}).get("category"),
            })

        print(json.dumps(output, ensure_ascii=False, indent=2), flush=True)
        sys.exit(0)

    except Exception as e:
        signal.alarm(0)
        sys.stderr.write(f"ERROR: {e}\n")
        print("[]", flush=True)
        sys.exit(0)

if __name__ == "__main__":
    main()
