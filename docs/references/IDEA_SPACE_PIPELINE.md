# Idea Space Pipeline

Last reviewed: 2026-02-18
Owner: Platform

## Purpose
Document the tuple-driven idea generation pipeline and its handoff contract to external deep-research execution utilities.

## Location
- Pipeline implementation: `idea-space-pipeline/`
- Main entrypoint: `idea-space-pipeline/cli.mjs`

## Current Flow
1. Enumerate valid tuples from taxonomy + constraints.
2. Build a heuristic-diverse shortlist.
3. LLM-rerank shortlist (fallback to heuristic on ranker failure).
4. Emit concrete `idea` briefs and `deepResearchTask` payloads per selection.
5. Persist run/seen state (and ranking metadata) when DB config is present.

## External Executor Contract
- Use `selection[].deepResearchTask` from CLI output, or export via:
  - `npm run ideas:export-tasks -- --input <candidates.json> --out <tasks.jsonl>`
- Each task contains:
  - `key`, `rank`, `title`, `researchQuestion`, `prompt`, `context`, and tuple fields.

## Operational Scripts
- `npm run ideas:generate`
- `npm run ideas:export-tasks`
- `npm run ideas:observe`
- `npm run ideas:retrain`
