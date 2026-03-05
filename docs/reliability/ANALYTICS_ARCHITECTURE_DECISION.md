# Analytics Architecture Decision

Last reviewed: 2026-03-05
Owner: Platform

## Decision
Keep PostHog on the shared `<ssh-host>` node for now, with a small-node profile enabled by default.

## Why
- Current traffic and budget fit a shared-node topology.
- Operational footprint is now controlled with memory caps and swap safeguards.
- Faster iteration: one host, one deployment path, fewer moving parts.

## Guardrails
- Trigger migration to dedicated analytics host if any are true:
  - sustained memory pressure (`available < 256MB`) during business hours.
  - repeated PostHog container restarts or OOM kills in a 24h window.
  - observability stack contention impacts DeepRecon API latency/error budgets.

## Next Review
- Re-evaluate this decision after 30 days of telemetry or before major traffic ramp.
