# Import Pipeline Runbook

Last reviewed: 2026-02-17
Owner: Platform

## Purpose
Operational runbook for importing external landscape sources into Recon maps with strict website verification.

## Scripts
- `scripts/import/ingest-sources.mjs`: fetch and normalize external sources into `data/imports`.
- `scripts/import/quality-check.mjs`: validate import record quality and legal flags.
- `scripts/import/merge-into-maps.mjs`: verify websites and merge verified entities into `data/maps`.
- `scripts/import/reverify-existing.mjs`: re-verify previously imported players and prune unverified entries.

## Commands
1. Ingest source snapshots:
`npm run import:sources -- --source all --write`

2. Validate import quality:
`npm run import:quality -- --all`

3. Merge with strict verification:
`npm run import:merge -- --source all --write --include-restricted --verify-timeout-ms 5000 --verify-concurrency 60`

4. Re-verify existing imported rows:
`npm run import:verify-map -- --source <source-name> --write`

## Verification policy
- Default: records must pass live website verification (`websiteStatus=verified`) before promotion.
- Skipped statuses: `dead`, `mismatch`, `parked`, `unknown`.
- The merge script supports `--no-verify`, but this should only be used for debugging.

## Source crosswalk
- Crosswalk file: `config/import-source-crosswalk.json`.
- Update this mapping when adding new sources or when category normalization drifts.

## Output locations
- Import snapshots: `data/imports/<source>/<YYYY-MM-DD>.json` and `data/imports/<source>/latest.json`.
- Import manifest: `data/imports/manifest.latest.json`.
- Quality reports: `data/imports/quarantine/<source>.latest.report.json`.

## Maintenance notes
- Run `node scripts/fixup-maps.mjs` after large merges to normalize aggregate fields.
- For operational safety, run full-source merges in lane worktrees and merge in batches.
