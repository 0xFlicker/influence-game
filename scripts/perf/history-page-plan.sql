SET TIME ZONE 'UTC';
EXPLAIN (ANALYZE, BUFFERS)
WITH visible_games AS (
 SELECT id, game_kind, ended_at, config, CASE WHEN config IS JSON OBJECT THEN config::jsonb ELSE NULL END AS cfg
 FROM games WHERE status='completed' AND ended_at IS NOT NULL AND hidden_at IS NULL
), valid_games AS NOT MATERIALIZED (
 SELECT * FROM visible_games WHERE cfg IS NOT NULL AND (NOT (cfg ? 'visibility') OR cfg->'visibility' IN ('"public"'::jsonb, '"unlisted"'::jsonb))
), owned AS (
 SELECT g.ended_at AS completed_at, g.id AS game_id, p.id AS player_id FROM valid_games g JOIN game_players p ON p.game_id=g.id WHERE g.game_kind='influence' AND p.user_id='history-benchmark-owner'
 UNION ALL
 SELECT g.ended_at, g.id, p.value->>'id' FROM valid_games g JOIN werewolf_events e ON e.game_id=g.id AND e.sequence=1
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.event->'payload'->'players')='array' THEN e.event->'payload'->'players' ELSE '[]'::jsonb END) p(value)
 JOIN agent_profiles a ON a.id=p.value->>'agentProfileId' AND a.user_id='history-benchmark-owner'
 WHERE g.game_kind='werewolf' AND e.event->>'type'='werewolf.started' AND e.event->>'gameId'=g.id AND e.event->>'sequence'='1' AND p.value->>'id' IS NOT NULL
), parsed AS (
 SELECT *, CASE WHEN completed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' AND pg_input_is_valid(completed_at, 'timestamp with time zone') THEN completed_at::timestamptz ELSE NULL END AS ts FROM owned
), ranked AS (
 SELECT game_id, player_id, (ts IS NOT NULL AND isfinite(ts)) AS has_instant,
 CASE WHEN ts IS NOT NULL AND isfinite(ts) THEN extract(epoch FROM ts) ELSE 0::numeric END AS instant FROM parsed
)
SELECT has_instant, instant::text AS epoch, game_id, player_id FROM ranked
ORDER BY has_instant DESC, instant DESC, game_id COLLATE "C" DESC, player_id COLLATE "C" DESC LIMIT 21;
