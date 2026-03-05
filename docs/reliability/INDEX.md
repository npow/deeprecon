# Reliability Index

Last reviewed: 2026-03-01
Owner: Platform

- `src/lib/telemetry.ts`: trace/timing instrumentation.
- `src/lib/relay-observability.ts`: route lifecycle telemetry wrapper + feature inference.
- `src/instrumentation.ts` + `instrumentation-client.ts`: Sentry runtime initialization and request/router error capture hooks.
- `scripts/scan-job-health.mjs`: stale/running visibility.
- `scripts/scan-job-reaper.mjs`: stale-job remediation.
- `scripts/deploy/observability/setup-hetzner-recon.sh`: repeatable Grafana/Loki/PostHog deployment on Hetzner.
- `docs/reliability/OBSERVABILITY_STACK.md`: operational runbook and rollback.
- `docs/reliability/OBSERVABILITY_TODO.md`: prioritized remaining observability work and acceptance criteria.
