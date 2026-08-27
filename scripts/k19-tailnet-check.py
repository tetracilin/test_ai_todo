#!/usr/bin/env python3
"""K19 acceptance helper: check tailnet reachability of the production Paperclip stack.

Prints one line: `tailnet status: <code>` on success, or `tailnet FAIL: <err>`.
"""
import urllib.request

URL = "http://100.103.41.112:3100/"

try:
    req = urllib.request.Request(URL, headers={"User-Agent": "k19-acceptance/1.0"})
    with urllib.request.urlopen(req, timeout=8) as r:
        body = r.read(200).decode("utf-8", "replace")
        print(f"tailnet status: {r.status}")
        print(f"body head: {body[:120]!r}")
except Exception as e:  # noqa: BLE001 — report any failure as text
    print(f"tailnet FAIL: {e}")
