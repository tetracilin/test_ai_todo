#!/bin/sh
# In-container Hermes reachability check for staging
HOST_ALIAS="${1:-host.docker.internal}"
URL="http://${HOST_ALIAS}:8642/health"
echo "resolve:"
getent hosts "$HOST_ALIAS" || echo "no DNS entry for $HOST_ALIAS"
echo "wget $URL:"
wget -qO- -T 3 "$URL" 2>&1 || echo "HERMES_NOT_REACHABLE"
