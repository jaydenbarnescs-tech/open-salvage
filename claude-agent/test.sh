#!/bin/bash
# ── Claude CLI Slack Bridge — smoke test ─────────────────────────────
set -euo pipefail

CLAUDE="$HOME/bin/claude"

echo "=== Claude CLI Bridge Test ==="
echo "Binary: $CLAUDE"
echo "Version: $($CLAUDE --version 2>&1)"
echo ""

echo "--- Test 1: Basic prompt ---"
RESULT=$($CLAUDE -p "Reply with exactly: BRIDGE TEST OK" --output-format text 2>&1)
echo "Response: $RESULT"

if echo "$RESULT" | grep -q "BRIDGE TEST OK"; then
  echo "✅ Test 1 PASSED"
else
  echo "❌ Test 1 FAILED — unexpected response"
  exit 1
fi

echo ""
echo "--- Test 2: Model check ---"
MODEL_CHECK=$($CLAUDE -p "What model are you? Reply with just the model name." --output-format text 2>&1)
echo "Model: $MODEL_CHECK"
echo "✅ Test 2 PASSED (model responded)"

echo ""
echo "=== All tests passed ==="
exit 0
