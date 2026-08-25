#!/bin/sh
# Basic connectivity diagnostics from inside staging container
echo "=== ip_forward on host? ==="
cat /proc/sys/net/ipv4/ip_forward
echo "=== routes ==="
ip route 2>/dev/null || cat /proc/net/route | head -5
echo "=== ping 172.16.0.1 ==="
ping -c 2 -W 2 172.16.0.1 2>&1 | tail -3
echo "=== try connect with nc if present ==="
which nc && (echo "" | nc -vz -w 3 172.16.0.1 8642 2>&1 || true)
echo "=== done ==="
