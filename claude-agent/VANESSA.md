# Vanessa — Slack bot bridge (backend-agnostic)

**Status:** dormant (kept, not running) as of 2026-07-19.

Vanessa lets you talk to a bot in Slack. It is **not tied to salvage** — the
processing backend is pluggable.

## Architecture
```
Slack event ─▶ nginx (Oracle) ─▶ SSH reverse tunnel VM:9091 ─▶ Mac:3100
              dispatcher.js (:3100)  → writes job to sqlite queue
              vanessa-worker.js      → runs the HANDLER, posts reply to Slack
```
- `dispatcher.js` — HTTP receiver on `:3100`, queues incoming Slack messages.
- `vanessa-worker.js` — single-consumer; pulls a job, runs the backend, posts the reply.
- Reverse tunnel: launchd `com.mgc.vanessa-slack-tunnel` (VM `:9091` → Mac `:3100`), currently **disabled**.

## Pluggable backend (this is the decoupling)
`vanessa-worker.js` picks its backend from env:

| Env | Behaviour |
|---|---|
| *(unset)* | Legacy mode — runs `~/bin/salvage` (the retired agent). Default only; not recommended. |
| `VANESSA_HANDLER=/path/to/bot` | **Simple mode** — runs `bot "<message>"` and posts its **stdout** to Slack verbatim. |
| `VANESSA_HANDLER_MODE=simple` | (default when `VANESSA_HANDLER` is set) |

### Plug in your own bot
A handler is any executable: it receives the user's message as `$1` and prints the
reply to stdout. Example: `vanessa-handlers/echo-bot.sh`.

```bash
export VANESSA_HANDLER=~/clawd/claude-agent/vanessa-handlers/echo-bot.sh
```
Put that in the `com.mgc.vanessa-worker` launchd plist's `EnvironmentVariables`, or
wire the handler to your own model/API call.

## Bring vanessa up (when you want it live)
```bash
UID=$(id -u)
for L in com.mgc.vanessa-dispatcher com.mgc.vanessa-worker com.mgc.vanessa-slack-tunnel; do
  launchctl enable  gui/$UID/$L
  launchctl bootstrap gui/$UID/~/Library/LaunchAgents/$L.plist
done
```
Requires `SLACK_BOT_TOKEN` in the worker env and the Oracle nginx `/slack/*` route +
the `:9091` tunnel (registered in `/etc/vm-governance/ports.json`).

## Registered
- agent-infra: `config/agents/registry.yaml` (system id `vanessa`)
- VM port registry: `:9091` in `/etc/vm-governance/ports.json`
