# Observability Maintenance

Last reviewed: 2026-03-05
Owner: Platform

## Retention Policy
- Loki logs: keep 14 days hot on-node (filesystem chunks).
- NDJSON app telemetry: retain 7 days in `recon_app-data` volume.
- Grafana dashboards/provisioning: source-controlled, no manual-only dashboards.

## Weekly Tasks
1. Verify stack health:
   - `ssh <ssh-host> 'cd /root/observability/grafana-loki && docker compose ps'`
2. Verify storage pressure:
   - `ssh <ssh-host> 'df -h / /var/lib/docker'`
3. Verify alerts/rules loaded:
   - `ssh <ssh-host> 'curl -s http://127.0.0.1:3100/prometheus/api/v1/rules >/dev/null'`

## Cleanup Cadence
- Weekly image prune:
  - `ssh <ssh-host> 'docker image prune -af --filter until=168h'`
- Weekly builder cache prune:
  - `ssh <ssh-host> 'docker builder prune -af --filter until=168h'`
- Monthly volume audit:
  - `ssh <ssh-host> 'docker system df -v'`

## NDJSON Rotation
- Keep file size bounded on host:
  - `ssh <ssh-host> \"find /var/lib/docker/volumes/recon_app-data/_data/telemetry -name 'events.ndjson' -size +500M -print\"`
- If oversized, archive and truncate during low-traffic window:
  - `ssh <ssh-host> 'cp events.ndjson events.ndjson.bak && : > events.ndjson'`
