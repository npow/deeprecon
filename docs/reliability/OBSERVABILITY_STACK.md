# Observability Stack

Last reviewed: 2026-03-01
Owner: Platform

## Purpose
Define the repeatable deployment for DeepRecon operational observability on `hetzner-recon`.

## Components
- Grafana + Loki + Promtail for backend operational logs and dashboards.
- PostHog hobby stack for product analytics and event exploration.
- Relay telemetry emitted from `src/lib/telemetry.ts` to configurable sinks (`ndjson`, `console`, `betterstack`).
- Sentry for server/client/edge exceptions and traces.

## Deployment
Run from repository root:

```bash
scripts/deploy/observability/setup-hetzner-recon.sh hetzner-recon
```

Optional env overrides:

```bash
GRAFANA_USER=admin \
GRAFANA_PASSWORD='strong-password' \
GRAFANA_DOMAIN=grafana.deeprecon.app \
POSTHOG_DOMAIN=posthog.deeprecon.app \
scripts/deploy/observability/setup-hetzner-recon.sh hetzner-recon
```

## What the script does
1. Ensures host swap exists (default `8GiB`, configurable with `SWAP_GB`) and sets `vm.swappiness=10`.
2. Uploads Grafana/Loki/Promtail compose + config to `/root/observability/grafana-loki`.
3. Starts Grafana/Loki/Promtail and provisions Loki datasource.
4. Clones PostHog and runs a hobby deployment in `/root/posthog-hobby`.
5. Applies a low-memory PostHog override (`WEB_CONCURRENCY=1`, `GRANIAN_WORKERS=1`, worker memory/process caps).
6. Forces DeepRecon relay telemetry sink to NDJSON (`TELEMETRY_SINKS=ndjson`).
7. Adds Caddy routes for `grafana.deeprecon.app` and `posthog.deeprecon.app`.
8. Performs host-header smoke checks for Grafana and PostHog health endpoints.

## Runtime paths on server
- DeepRecon telemetry file: `/var/lib/docker/volumes/recon_app-data/_data/telemetry/events.ndjson`
- Grafana/Loki stack: `/root/observability/grafana-loki`
- PostHog stack: `/root/posthog-hobby`

## Optional Hosted Backends
- Better Stack logs: set `TELEMETRY_SINKS=ndjson,betterstack` and `BETTERSTACK_SOURCE_TOKEN`.
- Better Stack or Grafana Cloud OTLP traces: set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`.
- Sentry: set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (plus optional sampling + build vars).

## Rollback

```bash
ssh hetzner-recon 'cd /root/observability/grafana-loki && docker compose down'
ssh hetzner-recon 'cd /root/posthog-hobby && docker compose down'
```

Then remove Caddy blocks in `/root/recon/Caddyfile` and reload:

```bash
ssh hetzner-recon 'cd /root/recon && docker compose up -d caddy'
```
