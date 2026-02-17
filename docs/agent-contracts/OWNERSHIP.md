# Ownership Map

Last reviewed: 2026-02-17
Owner: Platform

## Core Lanes
- Lane A (`scoring-core`): `src/lib/readiness-score.ts`, `src/lib/lucrativeness-score.ts`, scoring tests.
- Lane B (`orchestration`): `src/app/api/scan/route.ts`, `src/lib/scan-jobs-store.ts`, job lifecycle logic.
- Lane C (`contracts`): `src/lib/types.ts`, API route payload validation and schema consistency.
- Lane D (`ui-consumption`): `src/app/scans/*`, `src/components/results/*` score rendering/decision UX.
- Lane E (`quality-gates`): `scripts/*`, `.github/workflows/*`, benchmark fixtures and policy tests.

## Rules
- One lane owns final decisions in its files; cross-lane edits require a short note in PR body.
- If two lanes need same file, split into sequential tiny PRs rather than parallel conflicts.
- No lane may bypass quality gates for merge to `main`.
