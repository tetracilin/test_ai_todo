#!/usr/bin/env python3
"""K19: print all gateway/key-related config paths in Hermes config (names only)."""
import yaml

cfg = yaml.safe_load(open("/root/.hermes/config.yaml"))

def walk(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{path}{k}"
            if isinstance(v, (dict, list)):
                walk(v, p + ".")
            else:
                lower = k.lower()
                if any(s in lower for s in ("key", "token", "secret", "auth")):
                    print(f"{p} = {'<present>' if v else '<empty>'}")

walk(cfg)
