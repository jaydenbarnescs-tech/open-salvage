# MGC AI Workspace

The shared configuration and skill set that powers the MGC AI assistant (Vanessa / VP秘書).

Built on [OpenClaw](https://github.com/mechatron) — an AI agent harness by Anthropic's Claude.

---

## What's in here

| File / Folder | Purpose |
|---|---|
| `mechatron.json` | Core harness config (rate limits, skill injection) |
| `SOUL.md` | AI personality, behaviour rules, and priorities |
| `COMPANY.md` | MGC business context — clients, projects, model |
| `TEAM.md` | Team members (human + AI) and tech stack |
| `TOOLS.md` | Available MCP tools and infrastructure |
| `SLACK.md` | Slack channel IDs and user IDs |
| `NOTION.md` | Notion page ID reference |
| `USER.md` | Jayden's profile and preferences |
| `HEARTBEAT.md` | Periodic check-in behaviour |
| `skills/` | Custom skill definitions (image gen, lead register, etc.) |
| `avatars/` | Agent avatar images |

---

## Prerequisites

- [OpenClaw](https://openclaw.ai) installed and authenticated
- Claude API key
- MCP Proxy access (`mgc-pass-proxy.duckdns.org`) — ask Jayden for credentials
- Slack bot token — ask Jayden

---

## Setup

### 1. Clone this repo

```bash
git clone https://github.com/jayden-mgc/mgc-ai-workspace.git
cd mgc-ai-workspace
```

### 2. Point OpenClaw at this workspace

In your OpenClaw config, set the workspace path to this directory:

```json
{
  "workspace": "/path/to/mgc-ai-workspace"
}
```

### 3. Set up your memory folder

Create a local `memory/` folder (excluded from git — personal to each user):

```bash
mkdir memory
echo '{"tasks": [], "last_updated": ""}' > memory/tasks.json
```

### 4. Configure your USER.md

Edit `USER.md` with your own profile (name, role, timezone, communication style).

### 5. Start the assistant

```bash
openclaw start
```

---

## Notes

- `memory/` is **gitignored** — each person has their own local memory
- `SOUL.md`, `COMPANY.md`, `TEAM.md` are shared — changes here affect everyone
- Skills in `skills/` are shared and versioned
- If you add a new skill, commit it here so the team can use it

---

## Team

| Person | Role | GitHub |
|---|---|---|
| Jayden Barnes | VP of Growth | jayden-mgc |
| 松尾心夢 | CEO | koko1056-inv |
