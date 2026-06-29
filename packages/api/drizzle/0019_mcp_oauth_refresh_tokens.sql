CREATE TABLE "mcp_oauth_refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token_family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"wallet_address" text,
	"client_id" text NOT NULL,
	"resource_uri" text NOT NULL,
	"scope" text NOT NULL,
	"audience" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"replaced_at" text,
	"reused_at" text,
	"last_used_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "mcp_oauth_refresh_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "mcp_oauth_refresh_tokens_scope_check" CHECK ("scope" IN ('games', 'mcp')),
	CONSTRAINT "mcp_oauth_refresh_tokens_audience_check" CHECK ("audience" = 'game-mcp'),
	CONSTRAINT "mcp_oauth_refresh_tokens_purpose_check" CHECK ("purpose" = 'mcp_access')
);

ALTER TABLE "mcp_oauth_refresh_tokens"
	ADD CONSTRAINT "mcp_oauth_refresh_tokens_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
	ON DELETE cascade ON UPDATE no action;

ALTER TABLE "mcp_oauth_access_tokens"
	ADD COLUMN "refresh_token_id" text;

ALTER TABLE "mcp_oauth_access_tokens"
	ADD COLUMN "refresh_token_family_id" text;

ALTER TABLE "mcp_oauth_access_tokens"
	ADD CONSTRAINT "mcp_oauth_access_tokens_refresh_token_id_fk"
	FOREIGN KEY ("refresh_token_id") REFERENCES "public"."mcp_oauth_refresh_tokens"("id")
	ON DELETE set null ON UPDATE no action;

CREATE INDEX "mcp_oauth_refresh_tokens_token_family_id_idx"
	ON "mcp_oauth_refresh_tokens" USING btree ("token_family_id");

CREATE INDEX "mcp_oauth_refresh_tokens_user_id_idx"
	ON "mcp_oauth_refresh_tokens" USING btree ("user_id");

CREATE INDEX "mcp_oauth_refresh_tokens_resource_uri_idx"
	ON "mcp_oauth_refresh_tokens" USING btree ("resource_uri");

CREATE INDEX "mcp_oauth_refresh_tokens_expires_at_idx"
	ON "mcp_oauth_refresh_tokens" USING btree ("expires_at");

CREATE INDEX "mcp_oauth_access_tokens_refresh_token_family_id_idx"
	ON "mcp_oauth_access_tokens" USING btree ("refresh_token_family_id");
