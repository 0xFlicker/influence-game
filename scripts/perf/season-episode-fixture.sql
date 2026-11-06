-- Synthetic data for the disposable public-shelf benchmark only.
INSERT INTO seasons (id, slug, name, status) VALUES ('shelf-benchmark-season', 'shelf-benchmark-season', 'Benchmark season', 'final');
INSERT INTO games (id, slug, config, status, game_kind, season_id, created_at)
SELECT 'shelf-season-game-' || n, 'shelf-season-game-' || n, '{}', 'completed', 'influence', 'shelf-benchmark-season',
       to_char('2026-01-01'::timestamp + n * interval '1 second', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM generate_series(1, 10000) n;
ANALYZE games;
