CREATE TABLE agent_entry_intents (
  agent_id text PRIMARY KEY REFERENCES agent_profiles(id),
  user_id text NOT NULL REFERENCES users(id),
  intent jsonb NOT NULL,
  CONSTRAINT agent_entry_intents_shape CHECK (
    jsonb_typeof(intent)='object' AND (
      (intent->>'flow'='join_game' AND length(intent->>'gameId')>0) OR
      (intent->>'flow'='daily_free' AND length(intent->>'seasonId')>0)
    )
  )
);
