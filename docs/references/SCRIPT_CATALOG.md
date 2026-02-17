# Script Catalog

Last reviewed: 2026-02-17
Owner: Platform

## Purpose
Classify script entrypoints by operational role so one-off tooling does not mix with production workflows.

## Operational (keep)
- `scripts/import/`: external source ingest, quality gates, merge, re-verification.
- `scripts/lane-*.sh`: parallel lane worktree lifecycle.
- `scripts/scan-job-health.mjs`, `scripts/scan-job-reaper.mjs`: scan job reliability operations.
- `scripts/scan-telemetry-report.mjs`: scan telemetry reporting.
- `scripts/fixup-maps.mjs`: post-merge/map integrity normalization.
- `scripts/populate-bfs.mjs`, `scripts/enrich-loop.mjs`, `scripts/enrich-agents.mjs`, `scripts/enrich-v4.mjs`: map enrichment population flows.
- `scripts/quality-contract-check.mjs`, `scripts/docs-contract-check.mjs`, `scripts/architecture-contract-check.mjs`, `scripts/entropy-check.mjs`, `scripts/browser-smoke.mjs`: CI/quality gates.

## Structured maintenance (keep, infrequent)
- `scripts/migrations/`: one-time or low-frequency data migrations/backfills.
- `scripts/optimizer/`: optimization loop utilities and related helpers.
- `scripts/deploy/server-setup.sh`: first-time host bootstrap for deployment.

## Experimental (non-production)
- `scripts/experimental/`: ad-hoc model/debug experiments. Not part of CI and not expected to be stable.

## Usage conventions
- Add durable scripts to `package.json` if they are part of routine operations.
- Keep one-off or manual-only utilities out of root-level script namespace.
- Add/update docs entries in this file and `docs/references/INDEX.md` when introducing new script groups.
