#!/usr/bin/env bash
set -euo pipefail

LANE_HOME="${LANE_HOME:-/tmp/recon-lanes}"
if [[ ! -d "$LANE_HOME" ]]; then
  echo "No lanes found"
  exit 0
fi

for lane_dir in "$LANE_HOME"/*; do
  [[ -d "$lane_dir" ]] || continue
  lane_id=$(basename "$lane_dir")
  pid_file="$lane_dir/server.pid"
  port_file="$lane_dir/port"
  pid="-"
  port="-"
  status="stopped"

  [[ -f "$pid_file" ]] && pid=$(cat "$pid_file" || echo "-")
  [[ -f "$port_file" ]] && port=$(cat "$port_file" || echo "-")

  if [[ "$pid" != "-" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    status="running"
  fi

  echo "lane=${lane_id} status=${status} pid=${pid} port=${port}"
done
