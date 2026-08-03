LOCK TABLE "games" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.try_parse_game_config(value text)
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
    SELECT pg_temp.try_parse_game_config(game."config") AS parsed_config
  ) parsed
  WHERE jsonb_typeof(parsed.parsed_config) IS DISTINCT FROM 'object'
     OR (
       NOT parsed.parsed_config ? 'modelSelection'
       AND coalesce(parsed.parsed_config->>'modelTier', '') NOT IN ('budget', 'standard', 'premium')
     )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Game % has an invalid model configuration', invalid_game."id";
  END IF;
END $$;
--> statement-breakpoint
UPDATE "games" game
SET "config" = (
  (pg_temp.try_parse_game_config(game."config") - 'modelTier')
  || CASE
    WHEN pg_temp.try_parse_game_config(game."config") ? 'modelSelection' THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'modelSelection',
      jsonb_build_object(
        'catalogId',
        CASE pg_temp.try_parse_game_config(game."config")->>'modelTier'
          WHEN 'budget' THEN 'openai:gpt-5-nano'
          WHEN 'standard' THEN 'openai:gpt-5-mini'
          WHEN 'premium' THEN 'openai:gpt-5.4-mini'
        END,
        'reasoningPolicy', jsonb_build_object('type', 'action-policy')
      )
    )
  END
)::text;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "games" game
    CROSS JOIN LATERAL (
      SELECT pg_temp.try_parse_game_config(game."config") AS parsed_config
    ) parsed
    WHERE jsonb_typeof(parsed.parsed_config) IS DISTINCT FROM 'object'
       OR NOT parsed.parsed_config ? 'modelSelection'
       OR parsed.parsed_config ? 'modelTier'
  ) THEN
    RAISE EXCEPTION 'Game model selection migration did not converge';
  END IF;
END $$;
