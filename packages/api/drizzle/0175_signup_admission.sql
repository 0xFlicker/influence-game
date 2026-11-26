CREATE TABLE signup_bucket (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  rate bigint NOT NULL CHECK (rate BETWEEN 1 AND 9007199254740991),
  balance numeric(24, 0) NOT NULL CHECK (balance >= 0),
  updated_ms bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE signup_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  link_digest text NOT NULL UNIQUE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  closed_at timestamptz,
  CHECK (starts_at < ends_at)
);
--> statement-breakpoint
CREATE TABLE signup_campaign_sessions (
  digest text PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES signup_campaigns(id),
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX signup_campaign_sessions_expiry ON signup_campaign_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE signup_human_proofs (
  digest text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX signup_human_proofs_expiry ON signup_human_proofs(expires_at);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN deleted_by_user_id text REFERENCES users(id);
