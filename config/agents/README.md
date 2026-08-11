# Agents Config

This directory contains the canonical, machine-readable source files for the shared agent infrastructure.

## Purpose

These files exist so Claude, Codex, and related environments can share:

- tool discovery
- system discovery
- workflow metadata
- config generation inputs
- backup and migration conventions

## Rules

- Treat `registry.yaml` as the primary source of truth for shared agent infrastructure.
- Do not silently hand-edit generated outputs elsewhere without reflecting the change here.
- Archive before replacing managed outputs.
- Preserve unmanaged user-authored config outside explicitly managed files or sections.

## Initial Files

- `registry.yaml` — canonical registry for tools, systems, repos, workflows, and services
- future schema or projection helpers may live here as needed
