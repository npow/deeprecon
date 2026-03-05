# Observability Stack

Last reviewed: 2026-03-05
Owner: Platform

## Purpose
Define the repeatable deployment for DeepRecon operational observability on `<ssh-host>`.

## Components
- Grafana + Loki + Promtail for backend operational logs and dashboards.
- PostHog hobby stack for product analytics and event exploration.
- Relay telemetry emitted from `src/lib/telemetry.ts` to configurable sinks (`ndjson`, `console`, `betterstack`).
- Sentry for server/client/edge exceptions and traces.

## Deployment
Run from repository root:

```bash
scripts/deploy/observability/setup-hetzner-recon.sh <ssh-host>
```

Optional env overrides:

```bash
GRAFANA_USER=admin \
GRAFANA_PASSWORD='strong-password' \
GRAFANA_DOMAIN=<grafana-domain> \
POSTHOG_DOMAIN=<posthog-domain> \
POSTHOG_PROFILE=small-node \
scripts/deploy/observability/setup-hetzner-recon.sh <ssh-host>
```

## What the script does
1. Ensures host swap exists (default `8GiB`, configurable with `SWAP_GB`) and sets `vm.swappiness=10`.
2. Uploads Grafana/Loki/Promtail compose + config to `/root/observability/grafana-loki`.
3. Starts Grafana/Loki/Promtail and provisions Loki datasource.
4. Clones PostHog and runs a hobby deployment in `/root/posthog-hobby`.
5. Applies a low-memory PostHog override (`WEB_CONCURRENCY=1`, `GRANIAN_WORKERS=1`, worker memory/process caps).
6. Forces DeepRecon relay telemetry sink to NDJSON (`TELEMETRY_SINKS=ndjson`).
7. Adds Caddy routes for `<grafana-domain>` and `<posthog-domain>`.
8. Performs host-header smoke checks for Grafana and PostHog health endpoints.
9. Provisions Grafana dashboards from JSON in repo templates and Loki ruler alerts from committed rule files.

## Runtime paths on server
- DeepRecon telemetry file: `/var/lib/docker/volumes/recon_app-data/_data/telemetry/events.ndjson`
- Grafana/Loki stack: `/root/observability/grafana-loki`
- PostHog stack: `/root/posthog-hobby`

## Optional Hosted Backends
- Better Stack logs: set `TELEMETRY_SINKS=ndjson,betterstack` and `BETTERSTACK_SOURCE_TOKEN`.
- Better Stack or Grafana Cloud OTLP traces: set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`.
- Sentry: set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (plus optional sampling + build vars).

## Profiles
- `POSTHOG_PROFILE=small-node` (default): 8GB-friendly memory caps and reduced worker concurrency.
- `POSTHOG_PROFILE=standard`: no low-memory override; runs default PostHog compose.

## Alerts and Response
- Alert rules live in `scripts/deploy/observability/templates/grafana-loki/rules/deeprecon-alerts.yml`.
- Remediation playbook: `docs/reliability/OBSERVABILITY_ALERTS.md`.

## Rollback

```bash
ssh <ssh-host> 'cd /root/observability/grafana-loki && docker compose down'
ssh <ssh-host> 'cd /root/posthog-hobby && docker compose down'
```

Then remove Caddy blocks in `/root/recon/Caddyfile` and reload:

```bash
ssh <ssh-host> 'cd /root/recon && docker compose up -d caddy'
```
