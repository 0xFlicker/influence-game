CREATE TABLE game_retries (
  original_game_id text PRIMARY KEY REFERENCES games(id),
  replacement_game_id text NOT NULL UNIQUE REFERENCES games(id),
  actor_id text NOT NULL REFERENCES users(id),
  created_at text NOT NULL
);
