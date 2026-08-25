-- K16 staging: repoint hermes_gateway agents to the staging relay + staging API URL.
-- Staging-only change; the live embedded DB is never touched.
UPDATE agents
SET adapter_config = jsonb_set(
      jsonb_set(adapter_config, '{apiBaseUrl}', '"http://host.docker.internal:8642"'),
      '{paperclipApiUrl}', '"http://127.0.0.1:33120/api"')
WHERE adapter_type = 'hermes_gateway'
RETURNING id, adapter_config->>'apiBaseUrl' AS api_base_url, adapter_config->>'paperclipApiUrl' AS paperclip_api_url;
