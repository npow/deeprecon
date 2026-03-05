#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "Usage: $0 <ssh-host>"
  exit 1
fi
GRAFANA_DOMAIN="${GRAFANA_DOMAIN:-}"
POSTHOG_DOMAIN="${POSTHOG_DOMAIN:-}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-$(openssl rand -base64 24 | tr -d '=+/\n' | cut -c1-24)}"
SWAP_GB="${SWAP_GB:-8}"
POSTHOG_PROFILE="${POSTHOG_PROFILE:-small-node}"

: "${GRAFANA_DOMAIN:?Set GRAFANA_DOMAIN in environment (e.g., ~/.zshrc)}"
: "${POSTHOG_DOMAIN:?Set POSTHOG_DOMAIN in environment (e.g., ~/.zshrc)}"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATES_DIR="$ROOT_DIR/templates"

echo "[1/7] Ensuring swap and kernel memory tuning"
ssh "$HOST" "set -euo pipefail
if [ \"\$(swapon --show --noheadings | wc -l)\" -eq 0 ]; then
  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l ${SWAP_GB}G /swapfile
  else
    dd if=/dev/zero of=/swapfile bs=1M count=\$(( ${SWAP_GB} * 1024 ))
  fi
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
if grep -q '^vm.swappiness' /etc/sysctl.conf; then
  sed -i 's/^vm.swappiness.*/vm.swappiness=10/' /etc/sysctl.conf
else
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi"

echo "[2/7] Uploading Grafana/Loki stack files to $HOST"
ssh "$HOST" 'mkdir -p /root/observability/grafana-loki/provisioning/datasources /root/observability/grafana-loki/provisioning/dashboards /root/observability/grafana-loki/rules'
scp "$TEMPLATES_DIR/grafana-loki/docker-compose.yml" "$HOST:/root/observability/grafana-loki/docker-compose.yml"
scp "$TEMPLATES_DIR/grafana-loki/loki-config.yml" "$HOST:/root/observability/grafana-loki/loki-config.yml"
scp "$TEMPLATES_DIR/grafana-loki/promtail-config.yml" "$HOST:/root/observability/grafana-loki/promtail-config.yml"
scp "$TEMPLATES_DIR/grafana-loki/provisioning/datasources/datasource.yml" "$HOST:/root/observability/grafana-loki/provisioning/datasources/datasource.yml"
scp "$TEMPLATES_DIR/grafana-loki/provisioning/dashboards/provider.yml" "$HOST:/root/observability/grafana-loki/provisioning/dashboards/provider.yml"
scp "$TEMPLATES_DIR/grafana-loki/provisioning/dashboards/deeprecon-observability.json" "$HOST:/root/observability/grafana-loki/provisioning/dashboards/deeprecon-observability.json"
scp "$TEMPLATES_DIR/grafana-loki/rules/deeprecon-alerts.yml" "$HOST:/root/observability/grafana-loki/rules/deeprecon-alerts.yml"

echo "[3/7] Starting Grafana/Loki"
ssh "$HOST" "cat > /root/observability/grafana-loki/.env <<ENV
GRAFANA_ADMIN_USER=$GRAFANA_USER
GRAFANA_ADMIN_PASSWORD=$GRAFANA_PASSWORD
GRAFANA_ROOT_URL=https://$GRAFANA_DOMAIN
ENV
cd /root/observability/grafana-loki && docker compose up -d"

echo "[4/7] Installing PostHog hobby stack (profile: $POSTHOG_PROFILE)"
scp "$TEMPLATES_DIR/posthog/install-posthog.sh" "$HOST:/root/observability/install-posthog.sh"
ssh "$HOST" "chmod +x /root/observability/install-posthog.sh && /root/observability/install-posthog.sh '$POSTHOG_DOMAIN'"
if [ "$POSTHOG_PROFILE" = "small-node" ]; then
ssh "$HOST" "cat > /root/posthog-hobby/docker-compose.override.yml <<'EOF'
services:
  proxy:
    ports:
      - '127.0.0.1:18080:80'

  web:
    ports:
      - '127.0.0.1:18080:8000'
    environment:
      WEB_CONCURRENCY: '1'
      GRANIAN_WORKERS: '1'
    mem_limit: 1200m

  worker:
    environment:
      WEB_CONCURRENCY: '1'
      CELERY_MAX_TASKS_PER_CHILD: '20'
      CELERY_MAX_MEMORY_PER_CHILD: '300000'
      CELERY_WORKER_PREFETCH_MULTIPLIER: '1'
    mem_limit: 900m

  capture:
    ports:
      - '127.0.0.1:18081:3000'

  replay-capture:
    ports:
      - '127.0.0.1:18082:3000'

  feature-flags:
    ports:
      - '127.0.0.1:18083:3001'

  plugins:
    ports:
      - '127.0.0.1:18084:6738'

  livestream:
    ports:
      - '127.0.0.1:18085:8080'

  temporal:
    ports: []

  temporal-ui:
    ports: []
EOF
echo small-node > /root/posthog-hobby/.profile
cd /root/posthog-hobby && POSTHOG_IMAGE_VERSION=latest docker compose up -d web worker plugins capture replay-capture livestream"
else
ssh "$HOST" "rm -f /root/posthog-hobby/docker-compose.override.yml
echo standard > /root/posthog-hobby/.profile
cd /root/posthog-hobby && POSTHOG_IMAGE_VERSION=latest docker compose up -d"
fi

echo "[5/7] Ensuring DeepRecon emits NDJSON telemetry"
ssh "$HOST" 'if ! grep -q "^TELEMETRY_SINKS=" /root/recon/.env; then echo "TELEMETRY_SINKS=ndjson" >> /root/recon/.env; fi'
ssh "$HOST" 'cd /root/recon && docker compose up -d app'

echo "[6/7] Wiring Caddy routes"
ssh "$HOST" "python3 - <<'PY'
from pathlib import Path

path = Path('/root/recon/Caddyfile')
text = path.read_text()
blocks = {
    '${GRAFANA_DOMAIN}': '''\n${GRAFANA_DOMAIN} {\n\treverse_proxy 172.17.0.1:3001\n}\n''',
    '${POSTHOG_DOMAIN}': '''\n${POSTHOG_DOMAIN} {\n\treverse_proxy 172.17.0.1:18080\n}\n'''
}
changed = False
for domain, block in blocks.items():
    marker = f'{domain} {{'
    if marker not in text:
        text += block
        changed = True
if changed:
    path.write_text(text)
PY"
ssh "$HOST" 'cd /root/recon && docker compose up -d caddy'

echo "[7/7] Host + route smoke checks"
ssh "$HOST" "free -m | awk 'NR==2 { if (\$7 < 256) exit 1 }'"
ssh "$HOST" "swapon --show --noheadings | grep -q /swapfile"
ssh "$HOST" "docker inspect -f '{{.State.Running}}' grafana-loki-loki-1 | grep -q true"
ssh "$HOST" "docker inspect -f '{{.State.Running}}' grafana-loki-promtail-1 | grep -q true"
ssh "$HOST" "docker inspect -f '{{.State.Running}}' grafana-loki-grafana-1 | grep -q true"
ssh "$HOST" "docker inspect -f '{{.State.Running}}' posthog-hobby-web-1 | grep -q true"
ssh "$HOST" "docker inspect -f '{{.State.Running}}' posthog-hobby-worker-1 | grep -q true"
ssh "$HOST" "curl -sSf -H 'Host: $GRAFANA_DOMAIN' http://127.0.0.1/login >/dev/null"
ssh "$HOST" "curl -sSf -H 'Host: $POSTHOG_DOMAIN' http://127.0.0.1/_health >/dev/null"
ssh "$HOST" "cd /root/observability/grafana-loki && docker compose ps --status running >/dev/null"

echo

echo "Done."
echo "Grafana: https://$GRAFANA_DOMAIN"
echo "PostHog: https://$POSTHOG_DOMAIN"
echo "PostHog profile: $POSTHOG_PROFILE"
echo "Grafana user: $GRAFANA_USER"
echo "Grafana password: $GRAFANA_PASSWORD"
