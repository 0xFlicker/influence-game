ALTER TABLE users ADD COLUMN deleted_at text;
--> statement-breakpoint
CREATE TABLE account_deletion_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id),
  provider text NOT NULL CHECK (provider IN ('clerk', 'privy', 'posthog')),
  target text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX account_deletion_tasks_pending_idx ON account_deletion_tasks(next_attempt_at);
--> statement-breakpoint
-- Ratings and queued game bookkeeping may still update the tombstone. Identity
-- changes cannot restore it, including a request authenticated before deletion.
CREATE FUNCTION protect_deleted_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND (
    NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR
    NEW.email IS NOT NULL OR NEW.wallet_address IS NOT NULL OR
    NEW.display_name IS NOT NULL OR NEW.handle IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account has been deleted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_deleted_account_identity BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION protect_deleted_account_identity();
