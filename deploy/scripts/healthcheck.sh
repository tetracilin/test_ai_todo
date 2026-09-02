#!/usr/bin/env bash
# usage: healthcheck.sh <url> <expected-commit-sha> [attempts=30] [sleep=5]
# Polls an endpoint until the JSON response contains the expected commit SHA.
# Returns 0 if healthy, 1 if timeout.
set -euo pipefail

url="$1"
want="$2"
n="${3:-30}"
s="${4:-5}"

for i in $(seq 1 "$n"); do
  if body=$(curl -fsS --max-time 5 "$url" 2>/dev/null); then
    got=$(printf '%s' "$body" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p')
    if [[ "$got" == "$want"* ]] || [[ "$want" == "$got"* && -n "$got" ]]; then
      echo "✓ healthy: $url reports commit $got"
      exit 0
    fi
    echo "  attempt $i/$n: up but commit=$got (want $want)"
  else
    echo "  attempt $i/$n: not responding"
  fi
  sleep "$s"
done

echo "✗ FAILED: $url did not report commit $want after $n attempts" >&2
exit 1
