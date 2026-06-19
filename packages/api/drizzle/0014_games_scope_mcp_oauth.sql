ALTER TABLE "mcp_oauth_clients"
	DROP CONSTRAINT "mcp_oauth_clients_scope_check";

ALTER TABLE "mcp_oauth_authorization_codes"
	DROP CONSTRAINT "mcp_oauth_authorization_codes_scope_check";

ALTER TABLE "mcp_oauth_access_tokens"
	DROP CONSTRAINT "mcp_oauth_access_tokens_scope_check";

ALTER TABLE "mcp_oauth_authorization_codes"
	ALTER COLUMN "wallet_address" DROP NOT NULL;

ALTER TABLE "mcp_oauth_access_tokens"
	ALTER COLUMN "wallet_address" DROP NOT NULL;

ALTER TABLE "mcp_oauth_clients"
	ADD CONSTRAINT "mcp_oauth_clients_scope_check"
	CHECK ("scope" IN ('games', 'mcp', 'games mcp'));

ALTER TABLE "mcp_oauth_authorization_codes"
	ADD CONSTRAINT "mcp_oauth_authorization_codes_scope_check"
	CHECK ("scope" IN ('games', 'mcp'));

ALTER TABLE "mcp_oauth_access_tokens"
	ADD CONSTRAINT "mcp_oauth_access_tokens_scope_check"
	CHECK ("scope" IN ('games', 'mcp'));
