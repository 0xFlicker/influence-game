CREATE TABLE discord_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  discord_id text NOT NULL UNIQUE,
  username text NOT NULL,
  guild_id text NOT NULL,
  disconnecting boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  delivered_revision integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease uuid,
  lease_until timestamptz,
  last_error text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  CONSTRAINT discord_connections_snowflakes CHECK (discord_id ~ '^[0-9]{17,20}$' AND guild_id ~ '^[0-9]{17,20}$'),
  CONSTRAINT discord_connections_revisions CHECK (revision > 0 AND delivered_revision >= 0 AND delivered_revision <= revision)
);
--> statement-breakpoint
CREATE INDEX discord_connections_pending_idx ON discord_connections(next_attempt_at);
--> statement-breakpoint
CREATE TABLE discord_verification_attempts (
  state_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nonce_hash text NOT NULL,
  application_id text NOT NULL,
  redirect_uri text NOT NULL,
  guild_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','exchanging','verified','confirmed')),
  discord_id text,
  username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX discord_verification_attempts_user_idx ON discord_verification_attempts(user_id);
--> statement-breakpoint
CREATE TABLE discord_connection_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  discord_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('connected','refresh','disconnect','removed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
