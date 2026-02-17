# Parallel Taskboard (Map Population Acceleration)

Last reviewed: 2026-02-17
Owner: Platform

## Lane A: Source Ingest
- [x] Add source import pipeline script: `scripts/import/ingest-sources.mjs`.
- [x] Implement connectors: `ai-native-dev-landscape`, `awesome-ai-market-maps`, `hf-ai-market-maps`, `cncf-landscape`.
- [x] Persist per-source snapshots in `data/imports/<source>/<YYYY-MM-DD>.json` and `latest.json`.
Acceptance: `npm run import:sources -- --source all --dry-run` reports per-source parsed counts.

## Lane B: Taxonomy + Entity Resolution
- [x] Add source-to-canonical crosswalk file in `config/import-source-crosswalk.json`.
- [x] Add merge pipeline script: `scripts/import/merge-into-maps.mjs`.
- [ ] Add deterministic resolver (domain first, then normalized name, then fuzzy fallback).
- [ ] Emit confidence level for merged entities.
Acceptance: no duplicate entities within a subcategory after merge.

## Lane C: Quality + Legal Gates
- [x] Add import quality gate script: `scripts/import/quality-check.mjs`.
- [x] Validate required import fields (`name`, `sourceUrl`, `category`, `capturedAt`, `license`, legal flags).
- [x] Emit quarantine reports in `data/imports/quarantine/*.latest.report.json`.
Acceptance: `npm run import:quality -- --all` returns pass/fail and restricted-rate per source.

## Lane D: Throughput + Scheduling
- [ ] Add `--since` delta mode to ingestion for incremental refresh.
- [ ] Prioritize sparse subcategories for post-import enrichment in BFS workflow.
- [ ] Add calls/min + entities/min metrics to enrichment loop logs.
Acceptance: improved entities/min over baseline during 1-hour run.

## Lane E: UI + Observability
- [ ] Surface source provenance and confidence badges in map player cards.
- [ ] Add import metrics API and dashboard (source mix, dedupe rate, metadata completeness).
- [ ] Add restricted-source visibility in admin/debug views.
Acceptance: operators can trace each entity to source + ingestion timestamp from UI.

## Lane F: Standards Framework
- [ ] Publish scoring policy doc for map quality and analyst-style criteria.
- [ ] Add calibration script for weighted scoring (execution, vision, market presence, customer signal).
- [ ] Version calibration outputs for reproducibility.
Acceptance: same input snapshot produces stable score distributions.
