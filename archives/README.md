# Archives

This directory holds timestamped backups, manifests, and migration records for the shared agent infrastructure.

## Rules

- Never delete or overwrite important shared infrastructure without archiving first.
- Every major migration should create:
  - a snapshot directory or tarball
  - a manifest describing what was captured
  - a migration note explaining why
- Archives are a safety layer, not clutter.

## Layout

- `manifests/` — backup manifests and restore metadata
- `migrations/` — change logs and migration notes
- future timestamped backup bundles may also be stored here
