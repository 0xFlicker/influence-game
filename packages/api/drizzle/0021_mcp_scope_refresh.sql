DELETE FROM "mcp_oauth_access_tokens";
DELETE FROM "mcp_oauth_authorization_codes";
DELETE FROM "mcp_oauth_refresh_tokens";
DELETE FROM "mcp_oauth_clients";

ALTER TABLE "mcp_oauth_clients"
	DROP CONSTRAINT IF EXISTS "mcp_oauth_clients_scope_check";

ALTER TABLE "mcp_oauth_authorization_codes"
	DROP CONSTRAINT IF EXISTS "mcp_oauth_authorization_codes_scope_check";

ALTER TABLE "mcp_oauth_access_tokens"
	DROP CONSTRAINT IF EXISTS "mcp_oauth_access_tokens_scope_check";

ALTER TABLE "mcp_oauth_refresh_tokens"
	DROP CONSTRAINT IF EXISTS "mcp_oauth_refresh_tokens_scope_check";

ALTER TABLE "mcp_oauth_clients"
	ADD CONSTRAINT "mcp_oauth_clients_scope_check"
	CHECK ("scope" IN (
		'agents:read',
		'games:read',
		'producer',
		'agents:read agents:write',
		'agents:read games:read',
		'agents:read producer',
		'games:read producer',
		'agents:read agents:write games:read',
		'agents:read agents:write producer',
		'agents:read games:read producer',
		'agents:read agents:write games:read producer'
	));

ALTER TABLE "mcp_oauth_authorization_codes"
	ADD CONSTRAINT "mcp_oauth_authorization_codes_scope_check"
	CHECK ("scope" IN (
		'agents:read',
		'games:read',
		'producer',
		'agents:read agents:write',
		'agents:read games:read',
		'agents:read producer',
		'games:read producer',
		'agents:read agents:write games:read',
		'agents:read agents:write producer',
		'agents:read games:read producer',
		'agents:read agents:write games:read producer'
	));

ALTER TABLE "mcp_oauth_access_tokens"
	ADD CONSTRAINT "mcp_oauth_access_tokens_scope_check"
	CHECK ("scope" IN (
		'agents:read',
		'games:read',
		'producer',
		'agents:read agents:write',
		'agents:read games:read',
		'agents:read producer',
		'games:read producer',
		'agents:read agents:write games:read',
		'agents:read agents:write producer',
		'agents:read games:read producer',
		'agents:read agents:write games:read producer'
	));

ALTER TABLE "mcp_oauth_refresh_tokens"
	ADD CONSTRAINT "mcp_oauth_refresh_tokens_scope_check"
	CHECK ("scope" IN (
		'agents:read',
		'games:read',
		'agents:read agents:write',
		'agents:read games:read',
		'agents:read agents:write games:read'
	));

INSERT INTO "roles" ("id", "name", "description", "is_system")
VALUES ('role-producer', 'producer', 'Can authorize producer MCP access through OAuth', 1)
ON CONFLICT ("name") DO UPDATE
SET "description" = EXCLUDED."description",
	"is_system" = EXCLUDED."is_system";

INSERT INTO "address_roles" ("wallet_address", "role_id", "granted_by", "granted_at")
SELECT old_assignments."wallet_address",
	producer_role."id",
	COALESCE(old_assignments."granted_by", 'system'),
	old_assignments."granted_at"
FROM "address_roles" old_assignments
JOIN "roles" old_role
	ON old_role."id" = old_assignments."role_id"
	AND old_role."name" = 'mcp'
JOIN "roles" producer_role
	ON producer_role."name" = 'producer'
ON CONFLICT ("wallet_address", "role_id") DO NOTHING;

DELETE FROM "address_roles"
USING "roles"
WHERE "roles"."id" = "address_roles"."role_id"
	AND "roles"."name" = 'mcp';

DELETE FROM "role_permissions"
USING "roles"
WHERE "roles"."id" = "role_permissions"."role_id"
	AND "roles"."name" = 'mcp';

DELETE FROM "roles"
WHERE "name" = 'mcp';
