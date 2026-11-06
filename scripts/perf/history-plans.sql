\timing on
EXPLAIN (ANALYZE, BUFFERS)
SELECT g.id, gp.id,
       (SELECT count(*)::int FROM game_players seats WHERE seats.game_id = g.id)
FROM game_players gp JOIN games g ON g.id = gp.game_id
WHERE g.status = 'completed' AND g.ended_at IS NOT NULL AND g.hidden_at IS NULL
  AND g.game_kind = 'influence' AND gp.user_id = 'history-benchmark-owner'
ORDER BY g.ended_at DESC, g.id DESC, gp.id DESC;

EXPLAIN (ANALYZE, BUFFERS)
SELECT g.id, e.event
FROM games g JOIN werewolf_events e ON e.game_id = g.id AND e.sequence = 1
WHERE g.status = 'completed' AND g.ended_at IS NOT NULL AND g.hidden_at IS NULL
  AND g.game_kind = 'werewolf' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(e.event->'payload'->'players') p
    JOIN agent_profiles a ON a.id = p->>'agentProfileId'
    WHERE a.user_id = 'history-benchmark-owner'
  )
ORDER BY g.ended_at DESC, g.id DESC;
