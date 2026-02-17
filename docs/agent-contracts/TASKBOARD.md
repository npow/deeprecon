# Parallel Taskboard (Execution-Ready)

## Lane A: Scoring Core
- [ ] Add policy tests for clone/copycat/focus penalties.
- [ ] Keep differentiated wedge control >= 75 score in fixture tests.
- [ ] Add changelog entry for scoring policy revisions.
Acceptance: `npm run test` passes with new policy tests.

## Lane B: Orchestration
- [ ] Add stale job reaper (timeout -> failed) and heartbeat updates.
- [ ] Add job health summary script.
Acceptance: no `running` jobs older than configured TTL in health report.

## Lane C: Contracts
- [ ] Add API request/response schema tests for `/api/scan` and `/api/scan/jobs/[id]`.
- [ ] Validate required fields for persisted scans.
Acceptance: malformed payload tests fail as expected.

## Lane D: UI
- [ ] Surface clone-risk and lucrativeness coherently in feed/detail.
- [ ] Ensure score order/filtering is consistent between cards and thread view.
Acceptance: deterministic ordering tests for sort modes.

## Lane E: Quality Gates
- [ ] Maintain adversarial benchmark fixtures.
- [ ] CI gate to run policy tests + contract checks + type/build.
Acceptance: CI workflow blocks merge on policy regression.
