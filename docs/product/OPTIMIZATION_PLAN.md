# Autonomous Optimization Plan

Last reviewed: 2026-02-17
Owner: Product

## Decision Metrics
- `clone_false_positive_rate`: % clone-like prompts scoring A/B (target: <= 5%).
- `vague_false_positive_rate`: % vague prompts scoring A/B (target: <= 5%).
- `differentiated_false_negative_rate`: % strong-wedge prompts scoring below B (target: <= 10%).
- `stale_running_jobs`: running jobs older than TTL (target: 0).

## Weekly Execution Loop
1. Run adversarial and benchmark suites.
2. Compute metric deltas vs previous run.
3. Apply targeted patch in scoring/orchestration.
4. Re-run suite.
5. Accept only if metrics improve and build/tests pass.

## Guardrails
- No broad rewrites without metric evidence.
- Keep one change-set per root cause.
- Always preserve explainability in verdict output.
