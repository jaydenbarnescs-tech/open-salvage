# Agent Infrastructure Plan

This file is the working implementation plan for the shared Claude/Codex infrastructure.

It exists so the migration stays deliberate, reversible, and coherent across multiple sessions.

If implementation pauses midway, resume from this file before making new structural decisions.

## Mission

Build a shared agent infrastructure where:

- important projects are always searchable
- important tools are always searchable
- CLI tools stay first-class
- MCP is used selectively for discoverability and structured access
- Claude and Codex share the same operational map
- new tools and repos get registered correctly
- nothing important is ever deleted or overwritten without backup and rollback

## Core Principles

1. CLI is the execution layer.
2. MCP is the optional discovery/control layer.
3. `AGENTS.md` is the shared behavior layer.
4. `SYSTEMS.md` and `TOOLS.md` are the human-readable map.
5. `registry.yaml` is the machine-readable source of truth.
6. No destructive infra change without snapshot, manifest, and rollback path.
7. New shared tools/repos are not considered part of the platform until registered.

## Target Architecture

### 1. Canonical registry

Create `config/agents/registry.yaml` as the single source of truth for:

- CLI tools
- MCP servers
- repos
- systems
- workflows
- services
- docs
- aliases
- intent keywords
- risk level
- ownership
- secrets requirements
- archival status

### 2. Generated knowledge layer

Generate or maintain from the registry:

- `SYSTEMS.md`
- `TOOLS.md`
- optional `CLI_TOOLS.md`
- optional `WORKFLOWS.md`

`AGENTS.md` remains the shared rules layer and should point to the generated maps.

### 3. Config projection layer

Generate or sync agent-specific outputs from the registry:

- Claude project scope: `.mcp.json`
- Claude user references where appropriate
- Codex managed config sections in `~/.codex/config.toml`
- future support for other agent environments if needed

### 4. Backup, archive, and rollback layer

Create:

- `archives/`
- `archives/manifests/`
- `archives/migrations/`

Every structural migration must:

1. create a timestamped snapshot
2. record a manifest
3. preserve the last-known-good state
4. provide a rollback path

### 5. Intake and drift-control layer

Add scripts for:

- registering new tools
- registering new repos
- validating the registry
- auditing drift between reality and the registry
- syncing generated outputs
- backing up and restoring managed infrastructure

## Managed vs Unmanaged Boundaries

We must not blindly overwrite mixed user-authored config.

Rules:

- Prefer generated files or clearly managed sections.
- Preserve unmanaged content in shared config files.
- Archive before replacing.
- Never delete unknown content automatically.
- Mark deprecated things as archived before considering cleanup.

## Common Safety Rules To Enforce

These should become part of shared agent rules:

- Never delete, overwrite, or migrate shared infrastructure without first creating a timestamped backup, manifest, and rollback path.
- Preserve unknown user-authored content unless explicitly approved to remove it.
- New shared tools, repos, and workflows must be registered before they are considered part of the shared platform.
- Deprecated infrastructure is archived, not silently removed.

## Phased Rollout

### Phase 1. Discovery and path selection

Goals:

- choose canonical home for new infra files
- inventory current shared infra sources
- confirm which files are authoritative vs historical

Deliverables:

- this plan file
- initial directory layout

### Phase 2. Backup and archive scaffolding

Goals:

- create archive directory structure
- define backup naming convention
- implement backup manifest format

Deliverables:

- `archives/` layout
- `scripts/backup-agents`
- restore strategy

### Phase 3. Canonical registry

Goals:

- define registry schema
- create `config/agents/registry.yaml`
- add initial top-level sections for systems, tools, repos, workflows, services

Deliverables:

- registry skeleton
- schema notes

### Phase 4. Knowledge generation

Goals:

- make generated/shared docs flow from the registry
- keep `SYSTEMS.md` and `TOOLS.md` aligned with the registry over time

Deliverables:

- generator script scaffolding
- first generated or partially generated docs

### Phase 5. Config sync

Goals:

- sync Claude/Codex MCP-related config from the canonical registry
- protect unmanaged content

Deliverables:

- sync script
- managed config markers or explicit projection strategy

### Phase 6. Intake and audit workflow

Goals:

- guarantee new tools/repos are added correctly
- detect drift

Deliverables:

- `scripts/register-tool`
- `scripts/register-repo`
- `scripts/validate-agents`
- `scripts/audit-agents`

### Phase 7. Selective MCP promotion

Goals:

- promote only high-value CLI tools into named MCP wrappers
- leave long-tail tools as documented CLI unless promotion is justified

Initial candidates:

- `rmwhite`
- `site-scan`
- `worksheet`
- memory helpers
- selected operational/admin helpers

### Phase 8. Validation and handoff

Goals:

- verify natural-language discoverability
- verify restore path
- verify new intake workflow

Deliverables:

- test checklist
- next-steps notes

## Registry Requirements

Each tool entry should eventually support fields like:

- `id`
- `type`
- `name`
- `path`
- `command`
- `aliases`
- `intent_keywords`
- `description`
- `use_when`
- `avoid_when`
- `examples`
- `owner`
- `risk_level`
- `secrets_required`
- `backup_required`
- `promote_to_mcp`
- `status`

Each repo or system entry should support fields like:

- `id`
- `name`
- `repo_path`
- `github_repo`
- `summary`
- `docs`
- `related_tools`
- `skills`
- `status`

## Intake Lifecycle For New Things

Every new shared thing should move through this lifecycle:

1. discovered
2. registered as `draft`
3. validated
4. synced into docs/configs
5. marked `active`
6. eventually `deprecated`
7. `archived`

Nothing should jump directly from "exists on disk" to "shared infra everyone relies on" without registration.

## Current Implementation Order

The immediate next steps are:

1. create `config/agents/`
2. create `archives/` scaffolding
3. create `scripts/` scaffolding for backup/sync/validate/audit/register
4. create initial `registry.yaml`
5. record the generation and backup conventions

## Working Notes

- Existing useful shared docs already live in `/Users/jayden.csai/clawd/`.
- `SYSTEMS.md` already exists and should be treated as seed content for the registry, not discarded.
- `TOOLS.md` already exists and should be preserved while we gradually transition it toward generated or registry-backed structure.
- Existing Codex local-tools work should eventually be folded into the registry rather than remain ad hoc.
