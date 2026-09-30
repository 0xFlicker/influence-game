CREATE TABLE "user_roles" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "role_id" text NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "granted_by" text,
  "granted_at" text NOT NULL DEFAULT now()::text,
  PRIMARY KEY ("user_id", "role_id")
);
--> statement-breakpoint
-- Hold legacy writers until the archive fence commits, including writes
-- already in flight before candidate startup. This closes the backfill/fence gap.
LOCK TABLE "address_roles" IN SHARE ROW EXCLUSIVE MODE;

-- Case-insensitive matches must be unique. Unmatched/ambiguous grants stay in
-- address_roles for operator review and confer no authority in the new app.
INSERT INTO "user_roles" ("user_id", "role_id", "granted_by", "granted_at")
SELECT u.id, ar.role_id, COALESCE(granter.id, ar.granted_by), ar.granted_at
FROM "address_roles" ar
JOIN "users" u ON lower(u.wallet_address) = lower(ar.wallet_address)
LEFT JOIN "users" granter ON granter.id = (
  SELECT min(g.id) FROM "users" g
  WHERE lower(g.wallet_address) = lower(ar.granted_by)
  HAVING count(*) = 1
)
WHERE lower(u.wallet_address) <> '0x0000000000000000000000000000000000000000'
AND (SELECT count(*) FROM "users" candidate
       WHERE lower(candidate.wallet_address) = lower(ar.wallet_address)) = 1
ON CONFLICT ("user_id", "role_id") DO NOTHING;

--> statement-breakpoint
CREATE TABLE "service_principals" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE RESTRICT,
  "purpose" text NOT NULL DEFAULT 'free_queue',
  "enabled" boolean NOT NULL DEFAULT true,
  CONSTRAINT "service_principals_purpose_check" CHECK ("purpose" = 'free_queue')
);
--> statement-breakpoint
-- Preserve existing cron identity; no user/credential/token is created.
INSERT INTO "service_principals" ("user_id")
SELECT id FROM "users"
WHERE lower(wallet_address) = '0x0000000000000000000000000000000000000000';

--> statement-breakpoint
-- Fence legacy writers during blue/green overlap. The archive is immutable:
-- old binaries must not create grants that the new authority store cannot see.
CREATE FUNCTION reject_legacy_role_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Wallet role grants are archived; use account role management'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER address_roles_archive_read_only
BEFORE INSERT OR UPDATE OR DELETE ON address_roles
FOR EACH STATEMENT EXECUTE FUNCTION reject_legacy_role_mutation();
