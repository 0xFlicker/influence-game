CREATE TABLE "mcp_oauth_authorization_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "mcp_oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "mcp_oauth_authorization_codes_scope_check" CHECK ("scope" = 'mcp'),
	CONSTRAINT "mcp_oauth_authorization_codes_pkce_method_check" CHECK ("code_challenge_method" = 'S256')
);

CREATE TABLE "mcp_oauth_access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"client_id" text NOT NULL,
	"scope" text NOT NULL,
	"audience" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"last_used_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "mcp_oauth_access_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "mcp_oauth_access_tokens_scope_check" CHECK ("scope" = 'mcp'),
	CONSTRAINT "mcp_oauth_access_tokens_audience_check" CHECK ("audience" = 'game-mcp'),
	CONSTRAINT "mcp_oauth_access_tokens_purpose_check" CHECK ("purpose" = 'mcp_access')
);

ALTER TABLE "mcp_oauth_authorization_codes"
	ADD CONSTRAINT "mcp_oauth_authorization_codes_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
	ON DELETE cascade ON UPDATE no action;

ALTER TABLE "mcp_oauth_access_tokens"
	ADD CONSTRAINT "mcp_oauth_access_tokens_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
	ON DELETE cascade ON UPDATE no action;

CREATE INDEX "mcp_oauth_authorization_codes_user_id_idx" ON "mcp_oauth_authorization_codes" USING btree ("user_id");
CREATE INDEX "mcp_oauth_authorization_codes_expires_at_idx" ON "mcp_oauth_authorization_codes" USING btree ("expires_at");
CREATE INDEX "mcp_oauth_access_tokens_user_id_idx" ON "mcp_oauth_access_tokens" USING btree ("user_id");
CREATE INDEX "mcp_oauth_access_tokens_expires_at_idx" ON "mcp_oauth_access_tokens" USING btree ("expires_at");
