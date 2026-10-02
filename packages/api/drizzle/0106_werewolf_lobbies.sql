CREATE TABLE werewolf_lobby_seats (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  agent_profile_id text NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  joined_at text NOT NULL DEFAULT now()::text,
  CONSTRAINT werewolf_lobby_seat_unique UNIQUE(game_id, agent_profile_id)
);
