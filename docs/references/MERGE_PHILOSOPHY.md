# Merge Philosophy

Last reviewed: 2026-02-17
Owner: Platform

## Throughput-aware Merge Rules
- Keep PRs small and short-lived.
- Prefer rapid follow-up fixes over prolonged blocked queues.
- Maintain hard quality contracts while minimizing human serial bottlenecks.

## Operationalization
- Lane-based branch/worktree model (`scripts/lane-*.sh`)
- Contract and test automation in quality gates.
