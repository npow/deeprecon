#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-hetzner-recon}"
GRAFANA_DOMAIN="${GRAFANA_DOMAIN:-grafana.deeprecon.app}"
POSTHOG_DOMAIN="${POSTHOG_DOMAIN:-posthog.deeprecon.app}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-$(openssl rand -base64 24 | tr -d '=+/\n' | cut -c1-24)}"
SWAP_GB="${SWAP_GB:-8}"

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
ssh "$HOST" 'mkdir -p /root/observability/grafana-loki/provisioning/datasources'
scp "$TEMPLATES_DIR/grafana-loki/docker-compose.yml" "$HOST:/root/observability/grafana-loki/docker-compose.yml"
scp "$TEMPLATES_DIR/grafana-loki/loki-config.yml" "$HOST:/root/observability/grafana-loki/loki-config.yml"
scp "$TEMPLATES_DIR/grafana-loki/promtail-config.yml" "$HOST:/root/observability/grafana-loki/promtail-config.yml"
scp "$TEMPLATES_DIR/grafana-loki/provisioning/datasources/datasource.yml" "$HOST:/root/observability/grafana-loki/provisioning/datasources/datasource.yml"

echo "[3/7] Starting Grafana/Loki"
ssh "$HOST" "cat > /root/observability/grafana-loki/.env <<ENV
GRAFANA_ADMIN_USER=$GRAFANA_USER
GRAFANA_ADMIN_PASSWORD=$GRAFANA_PASSWORD
ENV
cd /root/observability/grafana-loki && docker compose up -d"

echo "[4/7] Installing PostHog hobby stack"
scp "$TEMPLATES_DIR/posthog/install-posthog.sh" "$HOST:/root/observability/install-posthog.sh"
ssh "$HOST" "chmod +x /root/observability/install-posthog.sh && /root/observability/install-posthog.sh '$POSTHOG_DOMAIN'"
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
cd /root/posthog-hobby && POSTHOG_IMAGE_VERSION=latest docker compose up -d web worker plugins capture replay-capture livestream"

echo "[5/7] Ensuring DeepRecon emits NDJSON telemetry"
ssh "$HOST" 'if ! grep -q "^TELEMETRY_SINKS=" /root/recon/.env; then echo "TELEMETRY_SINKS=ndjson" >> /root/recon/.env; fi'
ssh "$HOST" 'cd /root/recon && docker compose up -d app'

echo "[6/7] Wiring Caddy routes"
ssh "$HOST" "python3 - <<'PY'
from pathlib import Path

path = Path('/root/recon/Caddyfile')
text = path.read_text()
blocks = {
    'grafana': '''\ngrafana.deeprecon.app {\n\treverse_proxy 172.17.0.1:3001\n}\n''',
    'posthog': '''\nposthog.deeprecon.app {\n\treverse_proxy 172.17.0.1:18080\n}\n'''
}
changed = False
for key, block in blocks.items():
    marker = f'{key}.deeprecon.app {{'
    if marker not in text:
        text += block
        changed = True
if changed:
    path.write_text(text)
PY"
ssh "$HOST" 'cd /root/recon && docker compose up -d caddy'

echo "[7/7] Smoke checks"
ssh "$HOST" "curl -sSf -H 'Host: $GRAFANA_DOMAIN' http://127.0.0.1/login >/dev/null"
ssh "$HOST" "curl -sSf -H 'Host: $POSTHOG_DOMAIN' http://127.0.0.1/_health >/dev/null"

echo

echo "Done."
echo "Grafana: https://$GRAFANA_DOMAIN"
echo "PostHog: https://$POSTHOG_DOMAIN"
echo "Grafana user: $GRAFANA_USER"
echo "Grafana password: $GRAFANA_PASSWORD"
