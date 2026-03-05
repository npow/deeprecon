#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <posthog-domain>"
  exit 1
fi
WORKDIR="/root/posthog-hobby"
REPO_DIR="$WORKDIR/posthog"

mkdir -p "$WORKDIR"
cd "$WORKDIR"

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --filter=blob:none https://github.com/PostHog/posthog.git "$REPO_DIR"
fi

cd "$REPO_DIR"
git fetch origin
# Use official default branch tip for hobby setup compatibility
DEFAULT_BRANCH="$(git remote show origin | sed -n '/HEAD branch/s/.*: //p')"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-master}"
git checkout "$DEFAULT_BRANCH"
git reset --hard "origin/$DEFAULT_BRANCH"
cd "$WORKDIR"

if [ ! -f .env ]; then
  POSTHOG_SECRET="$(head -c 28 /dev/urandom | sha224sum -b | head -c 56)"
  ENCRYPTION_SALT_KEYS="$(openssl rand -hex 16)"
  cat > .env <<ENV
POSTHOG_SECRET=$POSTHOG_SECRET
ENCRYPTION_SALT_KEYS=$ENCRYPTION_SALT_KEYS
DOMAIN=$DOMAIN
REGISTRY_URL=posthog/posthog
POSTHOG_APP_TAG=latest
POSTHOG_NODE_TAG=latest
TLS_BLOCK=
CADDY_TLS_BLOCK=
CADDY_HOST=$DOMAIN
ENV
fi

mkdir -p compose
cat > compose/start <<'SCRIPT'
#!/bin/bash
./compose/wait
./bin/migrate
./bin/docker-server
SCRIPT
chmod +x compose/start

cat > compose/temporal-django-worker <<'SCRIPT'
#!/bin/bash
./bin/temporal-django-worker
SCRIPT
chmod +x compose/temporal-django-worker

cat > compose/wait <<'SCRIPT'
#!/usr/bin/env python3
import socket
import time

def loop():
    print("Waiting for ClickHouse and Postgres to be ready")
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.connect(('clickhouse', 9000))
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.connect(('db', 5432))
        print("Dependencies are ready")
    except ConnectionRefusedError:
        time.sleep(5)
        loop()

loop()
SCRIPT
chmod +x compose/wait

cp "$REPO_DIR/docker-compose.base.yml" docker-compose.base.yml
cp "$REPO_DIR/docker-compose.hobby.yml" docker-compose.yml

cat > docker-compose.override.yml <<'YAML'
services:
  proxy:
    ports:
      - "127.0.0.1:18080:80"

  objectstorage:
    ports: []

  temporal:
    ports: []

  temporal-ui:
    ports: []
YAML

docker compose up -d --pull always
