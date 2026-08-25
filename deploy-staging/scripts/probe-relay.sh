#!/bin/sh
# Quick reachability probe: relay port from inside container
HOST_ALIAS="${1:-172.16.0.1}"
echo "=== TCP connect probe to ${HOST_ALIAS}:8642 ==="
(echo > "/dev/tcp/${HOST_ALIAS}/8642") 2>&1 && echo "TCP_CONNECT_OK" || echo "TCP_CONNECT_FAIL"
echo "=== HTTP via wget, 8s cap ==="
wget -qO- -T 8 "http://${HOST_ALIAS}:8642/health" 2>&1 | head -c 200
echo ""
echo "=== exit probe ==="
