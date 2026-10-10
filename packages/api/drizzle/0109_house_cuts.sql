CREATE TABLE house_cut_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('public','mystery','omniscient')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ready','failed')),
  source jsonb, journal jsonb, publication jsonb,
  lease_token uuid, lease_until timestamptz, failure text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT house_cut_game_audience UNIQUE (game_id, audience)
);
