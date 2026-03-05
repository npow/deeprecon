# Observability TODO

Last reviewed: 2026-03-05
Owner: Platform

## Priority 0
- [ ] Stabilize PostHog on 8GB node.
Acceptance:
  - No container OOM kills for 24 hours.
  - `posthog-hobby-web-1` and `posthog-hobby-worker-1` remain healthy after restart.
- [~] Finalize external access for Grafana/PostHog.
Acceptance:
  - `<grafana-domain>` and `<posthog-domain>` resolve in DNS.
  - HTTPS works end-to-end with valid certs.

## Priority 1
- [x] Make PostHog footprint explicit in deployment script.
Acceptance:
  - `setup-hetzner-recon.sh` supports a documented "small-node" profile.
  - Profile is idempotent across re-runs.
- [x] Add host-level smoke checks to CI/deploy logs.
Acceptance:
  - Script checks include memory, swap, container status, and route health.
  - Script exits non-zero on failed checks.

## Priority 2
- [x] Add dashboards for relay and request lifecycle telemetry.
Acceptance:
  - Grafana dashboard includes request rate, error rate, p95 latency, and top failing routes.
  - Dashboard JSON is committed and provisioned automatically.
- [x] Add Loki queries/alerts for regressions.
Acceptance:
  - Alerts for elevated 5xx rate and repeated route failures.
  - Alerts documented with expected remediation steps.

## Priority 3
- [x] Decide long-term analytics architecture.
Acceptance:
  - Decision recorded: keep PostHog on shared node vs move to dedicated host.
  - Cost and reliability tradeoffs documented.
- [x] Add routine maintenance tasks.
Acceptance:
  - Log retention policy documented and enforced.
  - Docker/image cleanup cadence documented with commands.
