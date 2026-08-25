-- K16 staging: allow the hermes_gateway adapter to use the private plain-HTTP
-- bridge hop (host.docker.internal -> Hermes on 127.0.0.1) for this staging run.
-- This is the documented dev-only escape hatch (K13/K10); production should use
-- private TLS. Staging-only; live DB untouched.
UPDATE agents
SET adapter_config = jsonb_set(adapter_config, '{dangerouslyAllowInsecureRemoteHttp}', 'true')
WHERE id = '24c36c90-a6f8-4a58-ac67-b143eaa142dc'
RETURNING id, adapter_config->>'dangerouslyAllowInsecureRemoteHttp' AS allow_insecure;
