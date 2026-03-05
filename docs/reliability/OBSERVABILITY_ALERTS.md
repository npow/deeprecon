# Observability Alerts

Last reviewed: 2026-03-05
Owner: Platform

## Rules
- Source of truth: `scripts/deploy/observability/templates/grafana-loki/rules/deeprecon-alerts.yml`
- `DeepReconHigh5xxRate`:
  - Trigger: more than 20 server errors (5xx) in 5 minutes.
  - Severity: `warning`.
- `DeepReconRepeatedRouteFailures`:
  - Trigger: any single route has more than 8 server errors in 10 minutes.
  - Severity: `critical`.

## Remediation
1. Confirm active alerts in Loki ruler:
   - `ssh <ssh-host> 'curl -s http://127.0.0.1:3100/prometheus/api/v1/rules | jq .'`
2. Identify top failing routes:
   - Use Grafana dashboard panel `Top Failing Routes`.
   - Query fallback: `topk(10, sum by (route) (count_over_time({job="deeprecon",route=~".+"} | json | statusCode >= 500 [15m])))`
3. Correlate logs by route/request:
   - `{job="deeprecon",route="/api/scan"} | json`
   - Filter by `requestId` and `scanId` to isolate one failing flow.
4. Verify dependencies:
   - `docker ps --format '{{.Names}} {{.Status}}' | egrep 'recon-app|recon-redis|recon-metadata'`
   - Check DB/Redis/metadata connectivity from app logs.
5. Roll forward or rollback:
   - If recent deploy caused regression, roll back app image/config.
   - If dependency outage, recover dependency then restart app/caddy if needed.
6. Validate recovery:
   - `curl -sf https://<app-domain>/api/scan/jobs/health`
   - Confirm alert clears and 5xx rate panel trends down.
