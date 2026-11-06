-- Synthetic rows for an isolated, disposable test database only.
INSERT INTO games (id, slug, config, status, game_kind, created_at)
SELECT 'shelf-game-' || n, 'shelf-game-' || n,
       '{"providerManifest":[{"catalogId":"openai:gpt-5-nano"}]}', 'completed', 'influence',
       to_char('2026-11-01'::timestamp + n * interval '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM generate_series(1, 1000) n;
INSERT INTO game_players (id, game_id, persona, agent_config)
SELECT 'shelf-seat-' || n || '-' || seat, 'shelf-game-' || n, '{"name":"Synthetic player"}', '{}'
FROM generate_series(1, 1000) n CROSS JOIN generate_series(1, 8) seat;
ANALYZE games;
ANALYZE game_players;
