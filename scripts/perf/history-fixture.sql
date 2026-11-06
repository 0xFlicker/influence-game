-- Disposable synthetic benchmark. Run only inside the isolated test container.
INSERT INTO users (id) VALUES ('history-benchmark-owner');
INSERT INTO agent_profiles (id, user_id, name, personality)
  VALUES ('history-benchmark-profile', 'history-benchmark-owner', 'Fixture Agent', 'Synthetic');
INSERT INTO games (id, slug, config, status, game_kind, ended_at)
SELECT 'history-influence-' || n, 'history-influence-' || n, '{}', 'completed', 'influence',
       to_char('2026-01-01'::timestamp + n * interval '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM generate_series(1, 1000) AS n;
INSERT INTO game_players (id, game_id, user_id, agent_profile_id, persona, agent_config)
SELECT 'history-seat-' || g || '-' || seat, 'history-influence-' || g,
       CASE WHEN seat = 1 THEN 'history-benchmark-owner' END,
       CASE WHEN seat = 1 THEN 'history-benchmark-profile' END,
       '{"name":"Fixture"}', '{}'
FROM generate_series(1, 1000) AS g CROSS JOIN generate_series(1, 12) AS seat;
INSERT INTO games (id, slug, config, status, game_kind, ended_at)
SELECT 'history-wolf-' || n, 'history-wolf-' || n, '{}', 'completed', 'werewolf',
       to_char('2026-01-01'::timestamp + n * interval '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM generate_series(1, 1000) AS n;
INSERT INTO werewolf_events (game_id, sequence, event)
SELECT 'history-wolf-' || n, 1,
       jsonb_build_object('type','werewolf.started', 'gameId','history-wolf-' || n, 'sequence',1,
         'payload',jsonb_build_object('players',(
           SELECT jsonb_agg(jsonb_build_object('id','seat-' || n || '-' || seat,
             'agentProfileId', CASE WHEN seat = 12 THEN 'history-benchmark-profile' ELSE 'fixture-other' END,
             'name','Fixture') ORDER BY seat)
           FROM generate_series(1, 12) AS seat)))
FROM generate_series(1, 1000) AS n;
ANALYZE games;
ANALYZE game_players;
ANALYZE agent_profiles;
ANALYZE werewolf_events;
