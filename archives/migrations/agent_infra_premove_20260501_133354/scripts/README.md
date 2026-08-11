# Agent Infra Scripts

These scripts manage the shared agent infrastructure.

## Planned commands

- `backup-agents` — snapshot important config and docs before structural changes
- `restore-agents` — restore from a recorded backup
- `sync-agents` — project canonical registry data into generated outputs and managed config
- `validate-agents` — validate registry structure, referenced paths, and sync assumptions
- `audit-agents` — detect drift between the registry and the actual machine/repo state
- `register-tool` — add a new tool entry in draft form
- `register-repo` — add a new repo entry in draft form

## Rule

These scripts should prefer:

- explicit paths
- reversible behavior
- non-destructive defaults
- clear logging
