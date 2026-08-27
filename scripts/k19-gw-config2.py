#!/usr/bin/env python3
"""K19: check the gateway's api_server key resolution path more carefully.
The gateway was started with `hermes_cli.main gateway run` and HERMES_HOME=/root/.hermes.
Its _api_key = extra.get('key') or _get_scoped_secret('API_SERVER_KEY','').
config.yaml has no platforms.api_server — so where does the listener key come
from? Check the config.yaml for gateway/api_server sections (names only)."""
import yaml

cfg = yaml.safe_load(open("/root/.hermes/config.yaml"))
print("top-level keys:", sorted(cfg.keys()))
gw = cfg.get("gateway", {})
if isinstance(gw, dict):
    print("gateway keys:", sorted(gw.keys()))
    api = gw.get("api_server") or gw.get("apiServer")
    if api:
        print("gateway.api_server keys:", sorted(api.keys()) if isinstance(api, dict) else type(api))
