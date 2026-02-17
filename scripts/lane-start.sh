#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/lane-start.sh <lane-id> [port]" >&2
  exit 1
fi

LANE_ID="$1"
ROOT="$(git rev-parse --show-toplevel)"
LANE_HOME="${LANE_HOME:-/tmp/recon-lanes}"
LANE_DIR="${LANE_HOME}/${LANE_ID}"
WT_DIR="${LANE_DIR}/repo"
PID_FILE="${LANE_DIR}/server.pid"
PORT_FILE="${LANE_DIR}/port"
LOG_FILE="${LANE_DIR}/server.log"

mkdir -p "$LANE_DIR"

if [[ $# -ge 2 ]]; then
  PORT="$2"
else
  HASH=$(printf '%s' "$LANE_ID" | cksum | awk '{print $1}')
  PORT=$((4100 + (HASH % 400)))
fi

if [[ ! -d "$WT_DIR/.git" ]]; then
  BRANCH="lane/${LANE_ID}"
  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    git -C "$ROOT" worktree add "$WT_DIR" "$BRANCH"
  else
    git -C "$ROOT" worktree add -b "$BRANCH" "$WT_DIR" HEAD
  fi
fi

if [[ ! -e "$WT_DIR/node_modules" ]]; then
  ln -s "$ROOT/node_modules" "$WT_DIR/node_modules"
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE" || true)
  if [[ -n "${OLD_PID}" ]] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "Lane ${LANE_ID} already running (pid ${OLD_PID})" >&2
    exit 0
  fi
fi

mkdir -p "$WT_DIR/data"

(
  cd "$WT_DIR"
  PORT="$PORT" DISABLE_SCAN_RATE_LIMIT=1 NEXT_PUBLIC_DEBUG_MODE=1 npm run dev >"$LOG_FILE" 2>&1
) &

PID=$!
echo "$PID" > "$PID_FILE"
echo "$PORT" > "$PORT_FILE"

echo "lane=${LANE_ID} pid=${PID} port=${PORT} worktree=${WT_DIR}"
echo "log=${LOG_FILE}"
