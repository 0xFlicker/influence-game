-- Same-generation native xAI cutover. Frozen games and evidence remain untouched.
LOCK TABLE "games", "agent_profiles", "game_players", "werewolf_lobby_seats" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE FUNCTION pg_temp.native_grok_selection(value jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  result jsonb;
  child jsonb;
  item record;
  original text;
  replacement text;
  seen text[] := ARRAY[]::text[];
  identity text;
BEGIN
  IF jsonb_typeof(value) = 'string' THEN
    original := value #>> '{}';
    replacement := CASE original
      WHEN 'katana:grok-4-6' THEN 'xai:grok-4.6'
      WHEN 'katana:grok-4-5' THEN 'xai:grok-4.5'
      WHEN 'katana:grok-4-3' THEN 'xai:grok-4.3'
      WHEN 'katana:grok-4-20-multi-agent' THEN 'xai:grok-4.20-multi-agent-0309'
      ELSE NULL END;
    IF replacement IS NOT NULL THEN RETURN to_jsonb(replacement); END IF;
    IF original LIKE 'katana:grok-%' THEN
      RAISE EXCEPTION 'Unaudited Katana Grok selection: %; add its identical native mapping before cutover', original;
    END IF;
  ELSIF jsonb_typeof(value) = 'object' THEN
    result := '{}'::jsonb;
    FOR item IN SELECT key, val FROM jsonb_each(value) AS fields(key, val) LOOP
      result := result || jsonb_build_object(item.key, pg_temp.native_grok_selection(item.val));
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(value) = 'array' THEN
    result := '[]'::jsonb;
    FOR item IN SELECT val FROM jsonb_array_elements(value) AS items(val) LOOP
      child := pg_temp.native_grok_selection(item.val);
      identity := CASE WHEN jsonb_typeof(child) = 'string' THEN child #>> '{}' ELSE child->>'catalogId' END;
      -- First route wins; never add budgets when native/old routes collide.
      IF identity IS NULL OR NOT identity = ANY(seen) THEN
        result := result || jsonb_build_array(child);
        IF identity IS NOT NULL THEN seen := array_append(seen, identity); END IF;
      END IF;
    END LOOP;
    RETURN result;
  END IF;
  RETURN value;
END;
$$;
--> statement-breakpoint
UPDATE "agent_profiles" SET model_preference = pg_temp.native_grok_selection(model_preference)
WHERE model_preference IS DISTINCT FROM pg_temp.native_grok_selection(model_preference);
--> statement-breakpoint
UPDATE "game_players" AS seat SET model_preference = pg_temp.native_grok_selection(seat.model_preference)
FROM "games" AS game
WHERE seat.game_id = game.id AND game.status = 'waiting'
  AND NOT (game.config::jsonb->'modelRouting' ? 'contestants') IS TRUE
  AND NOT (game.config::jsonb->'modelRouting' ? 'frozenRoutes') IS TRUE
  AND seat.model_preference IS DISTINCT FROM pg_temp.native_grok_selection(seat.model_preference);
--> statement-breakpoint
UPDATE "werewolf_lobby_seats" AS seat SET model_preference = pg_temp.native_grok_selection(seat.model_preference)
FROM "games" AS game
WHERE seat.game_id = game.id AND game.status = 'waiting'
  AND NOT (game.config::jsonb->'modelRouting' ? 'contestants') IS TRUE
  AND NOT (game.config::jsonb->'modelRouting' ? 'frozenRoutes') IS TRUE
  AND seat.model_preference IS DISTINCT FROM pg_temp.native_grok_selection(seat.model_preference);
--> statement-breakpoint
UPDATE "games" AS game SET config = (
  SELECT jsonb_object_agg(key, CASE WHEN key IN ('modelSelection', 'providerManifest', 'modelRouting')
    THEN pg_temp.native_grok_selection(value) ELSE value END)::text FROM jsonb_each(game.config::jsonb)
)
WHERE status = 'waiting'
  AND NOT (config::jsonb->'modelRouting' ? 'contestants') IS TRUE
  AND NOT (config::jsonb->'modelRouting' ? 'frozenRoutes') IS TRUE
  AND EXISTS (SELECT 1 FROM jsonb_each(game.config::jsonb) WHERE key IN ('modelSelection', 'providerManifest', 'modelRouting')
    AND value IS DISTINCT FROM pg_temp.native_grok_selection(value));
--> statement-breakpoint
-- Explicit enrolled choices take precedence if old/native exclusions collapse.
UPDATE "games" AS game SET config = jsonb_set(config::jsonb, '{modelRouting,excludedCatalogIds}', (
  SELECT coalesce(jsonb_agg(exclusion), '[]'::jsonb)
  FROM jsonb_array_elements(config::jsonb #> '{modelRouting,excludedCatalogIds}') AS exclusions(exclusion)
  WHERE exclusion #>> '{}' NOT LIKE 'xai:grok-%'
    OR (NOT jsonb_path_query_array(config::jsonb->'modelRouting', '$.**.catalogId') @> jsonb_build_array(exclusion)
      AND NOT EXISTS (SELECT 1 FROM "game_players" WHERE game_id = game.id AND model_preference->'catalogId' = exclusion)
      AND NOT EXISTS (SELECT 1 FROM "werewolf_lobby_seats" WHERE game_id = game.id AND model_preference->'catalogId' = exclusion))
))::text
WHERE status = 'waiting'
  AND NOT (config::jsonb->'modelRouting' ? 'contestants') IS TRUE
  AND NOT (config::jsonb->'modelRouting' ? 'frozenRoutes') IS TRUE
  AND jsonb_typeof(config::jsonb #> '{modelRouting,excludedCatalogIds}') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(config::jsonb #> '{modelRouting,excludedCatalogIds}') AS exclusions(id)
    WHERE id LIKE 'xai:grok-%');
--> statement-breakpoint
DROP FUNCTION pg_temp.native_grok_selection(jsonb);
