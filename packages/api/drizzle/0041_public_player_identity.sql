CREATE OR REPLACE FUNCTION pg_temp.try_parse_public_identity_created_at(value text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
	RETURN value::timestamptz;
EXCEPTION WHEN others THEN
	RETURN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE
	invalid_count bigint;
BEGIN
	SELECT count(*)
	INTO invalid_count
	FROM "users"
	WHERE "created_at" IS NULL
		OR "created_at" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}|[+-][0-9]{4}|[+-][0-9]{2}:[0-9]{2})$'
		OR pg_temp.try_parse_public_identity_created_at("created_at") IS NULL;

	IF invalid_count > 0 THEN
		RAISE EXCEPTION 'public identity created_at preflight failed'
			USING
				ERRCODE = '23514',
				CONSTRAINT = 'users_created_at_offset_preflight',
				DETAIL = format('invalid_or_missing_rows=%s', invalid_count);
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_id" uuid;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "handle" text;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid();
--> statement-breakpoint
UPDATE "users"
SET "public_id" = gen_random_uuid()
WHERE "public_id" IS NULL;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "users" WHERE "public_id" IS NULL) THEN
		RAISE EXCEPTION 'public identity UUID backfill is incomplete'
			USING ERRCODE = '23514', CONSTRAINT = 'users_public_id_backfill_complete';
	END IF;

	IF EXISTS (
		SELECT "public_id"
		FROM "users"
		GROUP BY "public_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'public identity UUID backfill contains duplicates'
			USING ERRCODE = '23505', CONSTRAINT = 'users_public_id_unique';
	END IF;

	IF EXISTS (SELECT 1 FROM "users" WHERE "public_id"::text = "id") THEN
		RAISE EXCEPTION 'public identity UUID equals an internal user ID'
			USING ERRCODE = '23514', CONSTRAINT = 'users_public_id_distinct_from_internal_id_check';
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_public_id_unique" ON "users" USING btree ("public_id");
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "public_id" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_lower_unique" ON "users" USING btree (lower("handle"));
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_public_id_distinct_from_internal_id_check"
	CHECK ("users"."public_id"::text <> "users"."id");
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_canonical_check"
	CHECK ("users"."handle" IS NULL OR "users"."handle" = lower(btrim("users"."handle")));
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_length_check"
	CHECK ("users"."handle" IS NULL OR char_length("users"."handle") BETWEEN 3 AND 30);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_format_check"
	CHECK ("users"."handle" IS NULL OR "users"."handle" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$');
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_not_uuid_check"
	CHECK ("users"."handle" IS NULL OR "users"."handle" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_not_reserved_check"
	CHECK (
		"users"."handle" IS NULL OR "users"."handle" NOT IN (
			'about', 'admin', 'anonymous', 'api', 'dashboard', 'games', 'get-mcp', 'health',
			'house', 'internal', 'oauth', 'privacy', 'profile', 'rules', 'runtime-config', 'system'
		)
	);
--> statement-breakpoint
CREATE FUNCTION "prevent_users_public_id_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."public_id" IS DISTINCT FROM OLD."public_id" THEN
		RAISE EXCEPTION 'users.public_id is immutable'
			USING ERRCODE = '23514', CONSTRAINT = 'users_public_id_immutable';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "users_public_id_immutable"
BEFORE UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION "prevent_users_public_id_update"();
--> statement-breakpoint
CREATE FUNCTION "prevent_users_claimed_handle_clear"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."handle" IS NOT NULL AND NEW."handle" IS NULL THEN
		RAISE EXCEPTION 'a claimed users.handle cannot return to null'
			USING ERRCODE = '23514', CONSTRAINT = 'users_handle_claimed_not_null';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "users_handle_claimed_not_null"
BEFORE UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION "prevent_users_claimed_handle_clear"();
