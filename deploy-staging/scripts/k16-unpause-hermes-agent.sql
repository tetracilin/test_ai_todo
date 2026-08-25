-- K16 staging: unpause the hermes_gateway agent with the secret_ref apiKey so a
-- Hermes run can be triggered. Staging-only; the live DB is untouched.
UPDATE agents SET status = 'active' WHERE id = '24c36c90-a6f8-4a58-ac67-b143eaa142dc'
RETURNING id, name, status;
