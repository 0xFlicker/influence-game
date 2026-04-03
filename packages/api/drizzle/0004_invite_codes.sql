CREATE TABLE IF NOT EXISTS "invite_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL UNIQUE,
  "owner_id" text NOT NULL REFERENCES "users"("id"),
  "used_by_id" text REFERENCES "users"("id"),
  "used_at" text,
  "created_at" text NOT NULL DEFAULT now()::text
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" text NOT NULL DEFAULT now()::text
);--> statement-breakpoint

-- Default: invite codes not required
INSERT INTO "app_settings" ("key", "value", "updated_at")
VALUES ('invite_required', 'false', now()::text)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Grant 5 invite codes to every existing user
DO $$
DECLARE
  u RECORD;
  i INT;
BEGIN
  FOR u IN SELECT id FROM users LOOP
    FOR i IN 1..5 LOOP
      INSERT INTO invite_codes (id, code, owner_id, created_at)
      VALUES (
        gen_random_uuid()::text,
        upper(substr(md5(random()::text), 1, 8)),
        u.id,
        now()::text
      );
    END LOOP;
  END LOOP;
END $$;
