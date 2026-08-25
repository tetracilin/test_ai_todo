-- K16 staging: reactivate company 73f27949 so the hermes_gateway agent wake can
-- fire. The live DB is untouched; this only affects the isolated t3-staging stack.
UPDATE companies SET status = 'active' WHERE id = '73f27949-7ac6-41bb-a9c3-a79c547fe227'
RETURNING id, name, status;
