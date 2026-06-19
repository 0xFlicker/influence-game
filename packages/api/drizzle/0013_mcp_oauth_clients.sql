CREATE TABLE "mcp_oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_name" text,
	"redirect_uris" jsonb NOT NULL,
	"grant_types" jsonb NOT NULL,
	"response_types" jsonb NOT NULL,
	"scope" text NOT NULL,
	"token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
	"client_uri" text,
	"logo_uri" text,
	"tos_uri" text,
	"policy_uri" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "mcp_oauth_clients_scope_check" CHECK ("scope" = 'mcp'),
	CONSTRAINT "mcp_oauth_clients_token_auth_check" CHECK ("token_endpoint_auth_method" = 'none')
);

CREATE INDEX "mcp_oauth_clients_created_at_idx"
	ON "mcp_oauth_clients" USING btree ("created_at");
