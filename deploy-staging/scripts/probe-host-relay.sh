#!/bin/sh
# Host-side relay test: 172.16.0.1:8642 -> should forward to 127.0.0.1:8642
echo "=== host -> 172.16.0.1:8642 (via relay) ==="
wget -qO- -T 5 "http://172.16.0.1:8642/health" 2>&1 | head -c 200
echo ""
echo "=== host -> 127.0.0.1:8642 (direct Hermes) ==="
wget -qO- -T 5 "http://127.0.0.1:8642/health" 2>&1 | head -c 200
echo ""
echo "done"
