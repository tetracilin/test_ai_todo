#!/usr/bin/env bash
# version-drift.sh — Reports what commits are currently running vs. what's on main.
# Meant to be called during/after deploy to show if the stack is out of sync.
set -euo pipefail

echo "📊 Version drift report:"
echo

stacks=(t3-nightly t3-prod)
for stack in "${stacks[@]}"; do
  running=$(docker compose -p "$stack" images --format json 2>/dev/null | jq -r '.[0].ID' 2>/dev/null || echo "N/A")
  if [[ "$running" != "N/A" && -n "$running" ]]; then
    # Try to extract the commit from the running container's labels (if available)
    commit=$(docker inspect "$running" --format='{{.Config.Env}}' 2>/dev/null | grep -oP 'PAPERCLIP_BUILD_COMMIT=\K[0-9a-f]+' || echo "unknown")
    status="running commit $commit"
  else
    status="not running"
  fi
  echo "  $stack: $status"
done

echo
echo "  main branch HEAD: $(git rev-parse origin/main 2>/dev/null || echo 'unknown')"
