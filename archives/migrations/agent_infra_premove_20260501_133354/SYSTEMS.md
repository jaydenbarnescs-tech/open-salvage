# SYSTEMS.md — Cross-Project System Map

This is the canonical high-level map of Jayden's important systems, utilities, and adjacent infrastructure.

Use this file when:
- a task references a project by name without context
- work spans multiple repos or services
- you need to know whether a system exists locally, on GitHub, or behind shared infra
- you need to know which supporting files to read next

Do not treat this as the deepest source of truth. Treat it as the routing layer that tells you where to drill down.

## How To Use This Map

1. Identify the named system here.
2. Prefer the local repo if present.
3. Read the repo README, PRD, architecture docs, or skills named here.
4. Use `TOOLS.md` for MCP and infrastructure access details.
5. If a system is GitHub-only in this map, assume the remote repo exists but the local clone may be absent.

## Core Systems

### Nippo Syncro-kun
- Names: `nippo-sync`, `nippou-syncro-kun`, `nippo-sync-local`, `日報シンクロくん`
- Local repo: `/Users/jayden.csai/Developer/nippo-sync-local`
- GitHub: `jaydenbarnescs-tech/nippo-sync` and `jaydenbarnescs-tech/nippou-syncro-kun`
- Purpose: AI-powered daily report system that collects updates from Slack and other channels, classifies them with Claude, writes structured reports to Notion, and supports historical RAG queries.
- Current architecture:
  Slack and web app are active entry points.
  Oracle VM runs n8n orchestration and local model services.
  Supabase stores users, entries, reports, and vectors.
  Notion is the main end-user report surface.
- Important docs:
  `/Users/jayden.csai/Developer/nippo-sync-local/README.md`
  `/Users/jayden.csai/Developer/nippo-sync-local/docs/PRD_v2.md`
  `/Users/jayden.csai/Developer/nippo-sync-local/docs/ARCHITECTURE.md`
- Important internal skills:
  `nippo-architecture`
  `nippo-security`
  `nippo-llm-rag`
  `nippo-supabase-schema`
  `nippo-n8n-workflows`

### Oracle Server / MCP Proxy
- Names: `oracle-server`, `mgc-pass-proxy`, `FastMCP proxy`
- GitHub: `jaydenbarnescs-tech/oracle-server`
- Purpose: Oracle Cloud VM infrastructure for shared automation and MCP proxying.
- Known responsibilities:
  hosts `mgc-pass-proxy.duckdns.org`
  routes MCP-backed tools into agents
  hosts n8n and related services for Nippo Syncro-kun and other MGC systems
- Read next:
  `TOOLS.md` for the currently exposed tool surface
  the `oracle-server` repo when infra details are needed

### MGC Embedding Service
- Names: `mgc-embedding-service`
- GitHub: `jaydenbarnescs-tech/mgc-embedding-service`
- Purpose: shared embedding microservice for Nippo Sync and other systems.
- Observed GitHub description:
  Ollama BGE-M3 and Qwen3 embedding API on Oracle VM port `9300`
- Likely relationship:
  batch and query embeddings for RAG workloads, especially Nippo Sync

### MGC Research Agent
- Names: `mgc-research-agent`
- GitHub: `jaydenbarnescs-tech/mgc-research-agent`
- Purpose: universal web scraping, search, and contact enrichment microservice.
- Observed GitHub description:
  Oracle VM port `9200`
- Likely relationship:
  outbound research tasks, enrichment, crawler-backed lead gathering

### MGC Translation Workflow
- Names: `mgc-translation-workflow`
- Local repo: `/Users/jayden.csai/Developer/mgc-translation-workflow`
- GitHub: `jaydenbarnescs-tech/mgc-translation-workflow`
- Purpose: structured translation pipeline with glossary extraction, QA stages, and deliverable assembly.
- Key docs:
  `/Users/jayden.csai/Developer/mgc-translation-workflow/README.md`
  `/Users/jayden.csai/Developer/mgc-translation-workflow/SKILL.md`
- Key support scripts:
  `scripts/extract_miniglossy.py`
  `scripts/prescan_qa.py`
  `scripts/merge_qa_results.py`
  `scripts/compile_fixes.py`

### MGC Saiyo LP Bootstrap
- Names: `mgc-saiyo-lp-bootstrap`, `saiyo-lp-skill`
- Local skill path:
  `/Users/jayden.csai/.claude/skills/mgc-saiyo-lp-bootstrap`
- GitHub:
  `jaydenbarnescs-tech/mgc-saiyo-lp-bootstrap`
  `jaydenbarnescs-tech/saiyo-lp-skill`
- Purpose: bootstrap and generate Japanese recruitment landing pages quickly from references, with scraping, content synthesis, and deployment workflow support.

### MGC Docs Tool
- Names: `mgc-docs-tool`
- GitHub: `jaydenbarnescs-tech/mgc-docs-tool`
- Purpose: automated estimate and invoice generation with MCP tooling and docx generation.

## Utilities And Side Systems

### ICOCA Scraper
- Names: `icoca-scraper`
- Local repo: `/Users/jayden.csai/Developer/icoca-scraper`
- Purpose: Playwright-based automation for WESTER login and ICOCA history retrieval.
- Implementation notes:
  runs a local HTTP server on `127.0.0.1:3458`
  stores browser cookies in `session.json`
  fetches OTP codes via the shared proxy's Gmail search tool
- Read next:
  `/Users/jayden.csai/Developer/icoca-scraper/scrape.js`
- Caution:
  this repo contains live-style login automation and should be handled carefully; do not surface secrets in summaries or commits.

### Gemini Watermark Remover
- Names: `gemini-watermark-remover`
- Local repo: `/Users/jayden.csai/Developer/gemini-watermark-remover`
- GitHub: `GargantuaX/gemini-watermark-remover`
- Purpose: lossless Gemini watermark removal using reverse alpha blending, not AI inpainting.
- Delivery surfaces:
  browser UI
  userscript
  reusable SDK
  Node integration entrypoint
- Important docs:
  `/Users/jayden.csai/Developer/gemini-watermark-remover/README.md`
- Technical anchors:
  watermark size catalog
  validation-based detection
  browser and Node SDK exports

### rmwhite
- Names: `rmwhite`
- Local path: `/Users/jayden.csai/bin/rmwhite`
- Purpose: remove white backgrounds from PNGs using white-matte unmultiplication while preserving soft edges and shadows.
- Availability:
  exposed to Codex through the `local-tools` MCP server

### site-scan
- Names: `site-scan`
- Local path: `/Users/jayden.csai/bin/site-scan`
- Purpose: multi-breakpoint screenshot capture, asset extraction, and AI-assisted design analysis of websites.
- Availability:
  exposed to Codex through the `local-tools` MCP server

### worksheet
- Names: `worksheet`, `Yuina worksheet generator`
- Local path: `/Users/jayden.csai/bin/worksheet`
- Purpose: printable worksheet generation pipeline using local creative planning plus image generation workflow support.
- Availability:
  exposed to Codex through the `local-tools` MCP server

## Other Important GitHub Systems

These were observed in Jayden's GitHub account even when no local clone was confirmed during the latest scan.

### hikari-net-teian
- Purpose: ISP proposal bot with ElevenLabs conversational AI and Supabase.

### sorabito-komatsu-voice-ai
- Purpose: construction support voice AI PoC with ElevenLabs and RAG.

### influencer-bridge
- Purpose: brand-to-creator product seeding and affiliate commerce platform.

### mgc-dev-hub
- Purpose: development project dashboard for MGC systems.

### dtoc-scout
- Purpose: D2C brand scouting pipeline with funnel stages and registry/dashboard.

### obsidian-linkedin-autoposter
- Purpose: voice note to polished LinkedIn post automation.

## Operational Guidance

- When a task names a system from this file, mention that you are using the system map and then open the local repo or doc path listed here.
- For Nippo Sync work, prefer the repo-local skills before making architectural assumptions.
- For infra or tool questions, cross-check `TOOLS.md`.
- For image cleanup requests, prefer `rmwhite` for white backgrounds and `gemini-watermark-remover` only for Gemini watermark-specific workflows.
- When summarizing this ecosystem for humans, do not expose credentials or secrets even if some local scripts contain them.
