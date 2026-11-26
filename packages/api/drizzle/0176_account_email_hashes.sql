LOCK TABLE users, verified_email_claims IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN legacy_email_hash text
  CHECK (legacy_email_hash ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
ALTER TABLE verified_email_claims ADD COLUMN email_hash text
  CHECK (email_hash ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE TABLE drizzle.account_email_hash_config (id boolean PRIMARY KEY CHECK (id), key_check text NOT NULL);
--> statement-breakpoint
-- account-email-hash-backfill-v1
--> statement-breakpoint
CREATE INDEX users_legacy_email_hash_idx ON users(legacy_email_hash);
--> statement-breakpoint
ALTER TABLE verified_email_claims
  DROP CONSTRAINT verified_email_claims_pkey,
  ADD CONSTRAINT verified_email_claims_pkey PRIMARY KEY (email_hash),
  DROP COLUMN normalized_email;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_deleted_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND (
    NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR
    NEW.deleted_by_user_id IS DISTINCT FROM OLD.deleted_by_user_id OR
    NEW.legacy_email_hash IS NOT NULL OR NEW.wallet_address IS NOT NULL OR
    NEW.display_name IS NOT NULL OR NEW.handle IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account has been deleted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER TABLE users DROP COLUMN email;
--> statement-breakpoint
-- Rewrite the heap and indexes so removed columns are absent from the new relations.
ALTER TABLE users ALTER COLUMN legacy_email_hash TYPE text USING legacy_email_hash || '';
--> statement-breakpoint
ALTER TABLE verified_email_claims ALTER COLUMN email_hash TYPE text USING email_hash || '';
