# Parallel Execution Runbook

## Fast Start
1. Create lane worktree and server: `scripts/lane-start.sh <lane-id> [port]`
2. Run lane-specific tasks/tests.
3. Stop lane cleanly: `scripts/lane-stop.sh <lane-id>`
4. Inspect all lanes: `scripts/lane-status.sh`

## Branching Model
- Branch name format: `lane/<lane-id>/<task-slug>`
- Merge in small batches (<300 LOC preferred) every 2-3 hours.
- Rebase lane branches after each merge window.

## Safety
- Each lane runs on a dedicated port and PID file.
- Use quick-depth scan settings for harness tests unless validating full-depth behavior.
- Treat stale `running` jobs as failures and file against Lane B.
