#!/usr/bin/env python3
"""K19: check whether the run dispatch passes the apiKey binding through
`resolveAdapterConfigForRuntime` with `adapterType` — and if listAdapterSchemaSecretFieldKeys
returns 'apiKey' only when the adapter schema marks it secret. The hermes_gateway
adapter's config schema may mark a DIFFERENT field (e.g. 'token'). Check the
hermes gateway adapter's config schema in the container."""
import subprocess

probe = r"""
const reg = require('/app/node_modules/.pnpm/@paperclipai+hermes-paperclip-adapter@*/node_modules/@paperclipai/hermes-paperclip-adapter/dist/index.js');
"""
# simpler: grep dist for getConfigSchema / secret
out = subprocess.run(
    ["docker", "exec", "paperclip", "sh", "-c",
     "grep -rn 'secret' /app/server/dist/adapters/hermes-gateway-doc.js | head -5"],
    capture_output=True, text=True,
)
print(out.stdout)
