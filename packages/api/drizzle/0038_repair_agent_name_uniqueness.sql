LOCK TABLE "agent_profiles" IN EXCLUSIVE MODE;
LOCK TABLE "games", "game_players" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TEMPORARY TABLE "agent_profile_name_occupied" (
  "normalized_name" text PRIMARY KEY
) ON COMMIT DROP;
--> statement-breakpoint
CREATE TEMPORARY TABLE "agent_profile_name_repairs" (
  "profile_id" text PRIMARY KEY,
  "new_name" text NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.try_parse_agent_persona(value text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
--> statement-breakpoint
INSERT INTO "agent_profile_name_occupied" ("normalized_name") VALUES
  ('atlas'), ('vera'), ('finn'), ('mira'), ('rex'),
  ('lyra'), ('kael'), ('echo'), ('sage'), ('jace'),
  ('nyx'), ('orion'), ('zara'), ('riven'), ('luna'),
  ('thane'), ('iris'), ('cyrus'), ('wren'), ('dax')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "agent_profile_name_occupied" ("normalized_name")
SELECT DISTINCT lower(btrim("name"))
FROM "agent_profiles"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "agent_profile_name_occupied" ("normalized_name")
SELECT DISTINCT lower(btrim(parsed.persona->>'name'))
FROM "game_players" player
JOIN "games" game ON game."id" = player."game_id"
CROSS JOIN LATERAL (
  SELECT pg_temp.try_parse_agent_persona(player."persona") AS persona
) parsed
WHERE player."agent_profile_id" IS NULL
  AND game."status" = 'waiting'
  AND game."started_at" IS NULL
  AND jsonb_typeof(parsed.persona) = 'object'
  AND nullif(btrim(parsed.persona->>'name'), '') IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE
  profile record;
  suffix_ordinal integer;
  suffix_text text;
  candidate_name text;
BEGIN
  FOR profile IN
    WITH ranked_profiles AS (
      SELECT
        p."id",
        p."created_at",
        lower(btrim(p."name")) AS normalized_name,
        first_value(btrim(p."name")) OVER (
          PARTITION BY lower(btrim(p."name"))
          ORDER BY p."created_at"::timestamptz ASC, p."id" ASC
        ) AS group_base_name,
        row_number() OVER (
          PARTITION BY lower(btrim(p."name"))
          ORDER BY p."created_at"::timestamptz ASC, p."id" ASC
        ) AS duplicate_ordinal
      FROM "agent_profiles" p
    ),
    house_names(normalized_name, canonical_name) AS (
      VALUES
        ('atlas', 'Atlas'), ('vera', 'Vera'), ('finn', 'Finn'), ('mira', 'Mira'), ('rex', 'Rex'),
        ('lyra', 'Lyra'), ('kael', 'Kael'), ('echo', 'Echo'), ('sage', 'Sage'), ('jace', 'Jace'),
        ('nyx', 'Nyx'), ('orion', 'Orion'), ('zara', 'Zara'), ('riven', 'Riven'), ('luna', 'Luna'),
        ('thane', 'Thane'), ('iris', 'Iris'), ('cyrus', 'Cyrus'), ('wren', 'Wren'), ('dax', 'Dax')
    )
    SELECT
      ranked."id",
      ranked.normalized_name,
      ranked."created_at",
      coalesce(house.canonical_name, ranked.group_base_name) AS base_name
    FROM ranked_profiles ranked
    LEFT JOIN house_names house USING (normalized_name)
    WHERE house.normalized_name IS NOT NULL
       OR ranked.duplicate_ordinal > 1
    ORDER BY ranked.normalized_name ASC, ranked."created_at"::timestamptz ASC, ranked."id" ASC
  LOOP
    suffix_ordinal := 2;

    LOOP
      suffix_text :=
        repeat('M', suffix_ordinal / 1000)
        || (ARRAY['', 'C', 'CC', 'CCC', 'CD', 'D', 'DC', 'DCC', 'DCCC', 'CM'])[((suffix_ordinal % 1000) / 100) + 1]
        || (ARRAY['', 'X', 'XX', 'XXX', 'XL', 'L', 'LX', 'LXX', 'LXXX', 'XC'])[((suffix_ordinal % 100) / 10) + 1]
        || (ARRAY['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'])[(suffix_ordinal % 10) + 1];
      candidate_name := concat_ws(
        ' ',
        nullif(rtrim(left(profile.base_name, greatest(0, 80 - char_length(suffix_text) - 1))), ''),
        suffix_text
      );

      IF NOT EXISTS (
        SELECT 1
        FROM "agent_profile_name_occupied"
        WHERE "normalized_name" = lower(btrim(candidate_name))
      ) THEN
        INSERT INTO "agent_profile_name_occupied" ("normalized_name")
        VALUES (lower(btrim(candidate_name)));
        EXIT;
      END IF;

      suffix_ordinal := suffix_ordinal + 1;
    END LOOP;

    UPDATE "agent_profiles"
    SET "name" = candidate_name
    WHERE "id" = profile."id";

    INSERT INTO "agent_profile_name_repairs" ("profile_id", "new_name")
    VALUES (profile."id", candidate_name);
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE "game_players" player
SET "persona" = jsonb_set(
  pg_temp.try_parse_agent_persona(player."persona"),
  '{name}',
  to_jsonb(repair."new_name"),
  true
)::text
FROM "agent_profile_name_repairs" repair, "games" game
WHERE player."agent_profile_id" = repair."profile_id"
  AND game."id" = player."game_id"
  AND game."status" = 'waiting'
  AND game."started_at" IS NULL
  AND jsonb_typeof(pg_temp.try_parse_agent_persona(player."persona")) = 'object';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_profiles_normalized_name_unique"
  ON "agent_profiles" USING btree (lower(btrim("name")));
--> statement-breakpoint
ALTER TABLE "agent_profiles"
  ADD CONSTRAINT "agent_profiles_name_not_house_reserved"
  CHECK (
    lower(btrim("name")) NOT IN (
      'atlas', 'vera', 'finn', 'mira', 'rex',
      'lyra', 'kael', 'echo', 'sage', 'jace',
      'nyx', 'orion', 'zara', 'riven', 'luna',
      'thane', 'iris', 'cyrus', 'wren', 'dax'
    )
  );
