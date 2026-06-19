ALTER TABLE "mcp_oauth_authorization_codes"
	ADD COLUMN "resource_uri" text DEFAULT 'http://127.0.0.1:3000/mcp' NOT NULL;

ALTER TABLE "mcp_oauth_access_tokens"
	ADD COLUMN "resource_uri" text DEFAULT 'http://127.0.0.1:3000/mcp' NOT NULL;

ALTER TABLE "mcp_oauth_authorization_codes"
	ALTER COLUMN "resource_uri" DROP DEFAULT;

ALTER TABLE "mcp_oauth_access_tokens"
	ALTER COLUMN "resource_uri" DROP DEFAULT;

CREATE INDEX "mcp_oauth_authorization_codes_resource_uri_idx"
	ON "mcp_oauth_authorization_codes" USING btree ("resource_uri");

CREATE INDEX "mcp_oauth_access_tokens_resource_uri_idx"
	ON "mcp_oauth_access_tokens" USING btree ("resource_uri");
