SET TIME ZONE 'UTC';
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM games WHERE game_kind = 'influence' AND hidden_at IS NULL
AND jsonb_typeof(config::jsonb) = 'object' AND (NOT (config::jsonb ? 'visibility') OR config::jsonb->'visibility' = '"public"'::jsonb);
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM games WHERE game_kind = 'influence' AND hidden_at IS NULL
AND jsonb_typeof(config::jsonb) = 'object' AND (NOT (config::jsonb ? 'visibility') OR config::jsonb->'visibility' = '"public"'::jsonb)
ORDER BY CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}'
  AND pg_input_is_valid(created_at, 'timestamp with time zone') THEN created_at::timestamptz END DESC NULLS LAST, id DESC
LIMIT 6;
