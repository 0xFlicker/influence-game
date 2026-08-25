LOCK TABLE "games" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.try_parse_provider_manifest_config(value text)
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
DO $$
DECLARE
  invalid_game record;
BEGIN
  SELECT game."id", game."config"
  INTO invalid_game
  FROM "games" game
  CROSS JOIN LATERAL (
    SELECT pg_temp.try_parse_provider_manifest_config(game."config") AS parsed_config
  ) parsed
  WHERE jsonb_typeof(parsed.parsed_config) IS DISTINCT FROM 'object'
     OR jsonb_typeof(parsed.parsed_config->'modelSelection') IS DISTINCT FROM 'object'
     OR jsonb_typeof(parsed.parsed_config->'modelSelection'->'catalogId') IS DISTINCT FROM 'string'
     OR parsed.parsed_config->'modelSelection'->>'catalogId' = ''
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Game % cannot be backfilled with a provider manifest', invalid_game."id";
  END IF;
END $$;
--> statement-breakpoint
UPDATE "games" game
SET "config" = (
  pg_temp.try_parse_provider_manifest_config(game."config")
  || jsonb_build_object(
    'providerManifest',
    jsonb_build_array(pg_temp.try_parse_provider_manifest_config(game."config")->'modelSelection')
  )
)::text
WHERE NOT pg_temp.try_parse_provider_manifest_config(game."config") ? 'providerManifest';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "games" game
    CROSS JOIN LATERAL (
      SELECT pg_temp.try_parse_provider_manifest_config(game."config") AS parsed_config
    ) parsed
    WHERE jsonb_typeof(parsed.parsed_config->'providerManifest') IS DISTINCT FROM 'array'
       OR jsonb_array_length(parsed.parsed_config->'providerManifest') < 1
       OR parsed.parsed_config->'providerManifest'->0 IS DISTINCT FROM parsed.parsed_config->'modelSelection'
  ) THEN
    RAISE EXCEPTION 'Game provider manifest migration did not converge';
  END IF;
END $$;
