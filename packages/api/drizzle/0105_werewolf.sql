ALTER TABLE games ADD COLUMN game_kind text NOT NULL DEFAULT 'influence';
ALTER TABLE games ADD CONSTRAINT games_game_kind_check CHECK (game_kind IN ('influence', 'werewolf'));
ALTER TABLE agent_profiles ADD COLUMN werewolf_strategy_style text;
CREATE TABLE werewolf_events (
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  event jsonb NOT NULL,
  PRIMARY KEY (game_id, sequence)
);
CREATE TABLE werewolf_turns (
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  request jsonb NOT NULL,
  observation_hash text NOT NULL,
  PRIMARY KEY (game_id, sequence)
);
