# Reliability

Last reviewed: 2026-02-17
Owner: Platform

## Required Reliability Mechanisms
- Telemetry timings and traces (`src/lib/telemetry.ts`)
- Stale scan job health visibility (`scripts/scan-job-health.mjs`)
- Stale scan job remediation (`scripts/scan-job-reaper.mjs`)

## SLO-oriented Checks
- No stale running jobs above threshold.
- No critical stage timeout regressions versus telemetry reports.
