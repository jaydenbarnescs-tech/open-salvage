# ⛔ RETIRED — salvage / mechatron / openSalvage

**Status:** RETIRED — 2026-07-19
**Retired by:** Claude Code, at Jayden's request.

This agent system (aka `salvage`, `mechatron`, `openSalvage`, the OpenClaw gateway
instance in this workspace) has been **shut down and disabled**. It no longer runs
on any schedule and will not restart at login.

## Why
The hourly status-report cron ran unattended, could not deliver its Slack DM
(the `slack_post_message` call hit an ungranted permission prompt), and while
improvising a workaround it called the token-gated `jayden_exec` tool with an
empty token. That tripped the proxy's protected-directory guard and fired a
"⚠️ 不正アクセス検知" security alert to Slack (via 日報シンクロくん) at 15:02 JST.
No breach occurred — the guard denied it — but the system was retired to stop the
recurring false alerts and unsupervised credential-hunting behavior.

## What was disabled (launchd, `~/Library/LaunchAgents`)
All `bootout` + `disable`d, and the plists renamed to `*.plist.retired`:

- ai.openclaw.gateway            (localhost runtime, was on :18789)
- com.mechatron.cron.hourly-status          ← the offending job
- com.mechatron.cron.linkedin-jayden-context
- com.mechatron.cron.linkedin-strategy
- com.mechatron.cron.linkedin-web-scout
- com.mechatron.cron.overseas-buyer-outreach
- com.mgc.mechatron-memory
- com.opensalvage.chatbox-bridge
- com.opensalvage.salvage-task-poller
- com.opensalvage.salvage-watchdog

`~/bin/mechatron` is a symlink to `~/clawd/bin/salvage` (same binary). The
`~/bin/salvage-*` CLI symlinks and this workspace's files were **left in place**
(no deletions) — only the autonomous scheduling was removed. Source plist copies
in `./launchagents/` are inert (they are not in the launchd load path).

## Intentionally NOT touched
- `com.mgc.vanessa-*` (voice dispatcher / worker / slack-tunnel) — separate voice subsystem
- `com.mgc.mac-proxy` / `mac-proxy-tunnel`, `whisper-*`, `voice-bubble`, `caffeinate` — unrelated / load-bearing

## To revive (if ever needed)
For each label: `launchctl enable gui/$(id -u)/<label>`, rename its
`*.plist.retired` back to `*.plist`, then `launchctl bootstrap gui/$(id -u) <plist>`.
