#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/lane-stop.sh <lane-id>" >&2
  exit 1
fi

LANE_ID="$1"
LANE_HOME="${LANE_HOME:-/tmp/recon-lanes}"
LANE_DIR="${LANE_HOME}/${LANE_ID}"
PID_FILE="${LANE_DIR}/server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No pid file for lane ${LANE_ID}" >&2
  exit 0
fi

PID=$(cat "$PID_FILE" || true)
if [[ -n "${PID}" ]] && kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" || true
  sleep 1
  if kill -0 "$PID" >/dev/null 2>&1; then
    kill -9 "$PID" || true
  fi
fi

rm -f "$PID_FILE"
echo "lane=${LANE_ID} stopped"
