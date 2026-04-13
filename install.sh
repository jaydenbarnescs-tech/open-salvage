#!/bin/bash
# install.sh — Set up salvage on a new Mac from this repo
#
# Run once after cloning:
#   git clone https://github.com/jaydenbarnescs-tech/open-salvage ~/clawd
#   cd ~/clawd && bash install.sh
#
# What this does:
#   1. Creates ~/bin/ symlinks for all salvage* scripts
#   2. Copies LaunchAgent plists to ~/Library/LaunchAgents/
#   3. Loads LaunchAgents (starts services)
#   4. Installs claude-agent npm dependencies
#   5. Creates ~/.salvage/ config skeleton (you fill in secrets)

set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
HOME="${HOME:-/Users/$(whoami)}"

echo "=== salvage install ==="
echo "Repo: $REPO"
echo "Home: $HOME"
echo ""

# ── 1. Symlink bin scripts ─────────────────────────────────────────────────
echo "→ Linking bin scripts to ~/bin/..."
mkdir -p "$HOME/bin"
for script in "$REPO/bin"/salvage*; do
  name=$(basename "$script")
  target="$HOME/bin/$name"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -f "$target" ]; then
    echo "  WARNING: $target exists and is not a symlink — backing up to $target.bak"
    mv "$target" "$target.bak"
  fi
  ln -s "$script" "$target"
  chmod +x "$script"
  echo "  linked: ~/bin/$name"
done

# ── 2. Install LaunchAgents ────────────────────────────────────────────────
echo ""
echo "→ Installing LaunchAgents..."
mkdir -p "$HOME/Library/LaunchAgents"
for plist in "$REPO/launchagents"/*.plist; do
  name=$(basename "$plist")
  dest="$HOME/Library/LaunchAgents/$name"
  cp "$plist" "$dest"
  # Update HOME path in plist if needed
  sed -i '' "s|/Users/jayden.csai|$HOME|g" "$dest" 2>/dev/null || true
  echo "  installed: $name"
done

# ── 3. Load LaunchAgents ───────────────────────────────────────────────────
echo ""
echo "→ Loading LaunchAgents..."
AGENTS=(
  "com.opensalvage.salvage-task-poller"
  "com.opensalvage.salvage-watchdog"
  "com.opensalvage.salvage-memory"
  "ai.openclaw.gateway"
)
for agent in "${AGENTS[@]}"; do
  plist="$HOME/Library/LaunchAgents/$agent.plist"
  [ -f "$plist" ] || continue
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist" 2>/dev/null && echo "  loaded: $agent" || echo "  WARNING: failed to load $agent"
done

# ── 4. claude-agent npm dependencies ──────────────────────────────────────
echo ""
echo "→ Installing claude-agent dependencies..."
if [ -f "$REPO/claude-agent/package.json" ]; then
  (cd "$REPO/claude-agent" && npm install --silent 2>/dev/null && echo "  npm install done") || echo "  WARNING: npm install failed"
fi

# ── 5. ~/.salvage/ config skeleton ──────────────────────────────────────
echo ""
echo "→ Setting up ~/.salvage/..."
mkdir -p "$HOME/.salvage/cron"

if [ ! -f "$HOME/.salvage/config.json" ]; then
  cp "$REPO/config/salvage-config.json" "$HOME/.salvage/config.json"
  sed -i '' "s|/Users/jayden.csai|$HOME|g" "$HOME/.salvage/config.json" 2>/dev/null || true
  echo "  created: ~/.salvage/config.json"
fi

if [ ! -f "$HOME/.salvage/tools.json" ]; then
  cp "$REPO/config/salvage-tools.json" "$HOME/.salvage/tools.json"
  sed -i '' "s|/Users/jayden.csai|$HOME|g" "$HOME/.salvage/tools.json" 2>/dev/null || true
  echo "  created: ~/.salvage/tools.json"
fi

if [ ! -f "$HOME/.salvage/mcp-config.json" ]; then
  cp "$REPO/config/mcp-config.example.json" "$HOME/.salvage/mcp-config.json"
  echo "  created: ~/.salvage/mcp-config.json (NEEDS SECRETS — edit before use)"
  echo ""
  echo "  ⚠️  Fill in these values in ~/.salvage/mcp-config.json:"
  echo "     SLACK_BOT_TOKEN     — Slack bot token (xoxb-...)"
  echo "     GOOGLE_AI_API_KEY   — Google AI key for image generation"
fi

# ── 6. Initialise database ─────────────────────────────────────────────────
echo ""
echo "→ Initialising agent database..."
WORKSPACE="${SALVAGE_WORKSPACE:-$HOME/clawd}"
mkdir -p "$WORKSPACE/sessions"
"$HOME/bin/salvage-db" init 2>/dev/null && echo "  DB ready: $WORKSPACE/sessions/agent.db" || echo "  WARNING: DB init failed"

echo ""
echo "=== install complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit ~/.salvage/mcp-config.json and fill in secrets"
echo "  2. Run: salvage --workspace ~/clawd --task general -p 'hello'"
