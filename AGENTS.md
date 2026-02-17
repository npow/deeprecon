# AGENTS

Last reviewed: 2026-02-17
Owner: Platform

## Purpose
This file is the top-level agent map for the repository. It points to the canonical architecture, process contracts, and quality gates that every agent run must honor.

## Canonical Entry Points
- Architecture: `ARCHITECTURE.md`
- Docs index: `docs/INDEX.md`
- Agent operating contracts: `docs/agent-contracts/`
- Quality and policy gates: `.github/workflows/quality-gates.yml`

## Non-Negotiable Rules
- Do not bypass quality gates.
- Keep provider architecture aligned to `src/lib/provider-catalog.ts`.
- Validate browser-visible behavior with `npm run test:browser` before merge windows.
- Treat docs as code: update docs indexes and `Last reviewed` markers when behavior changes.
