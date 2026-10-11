CREATE TABLE game_retrospective_inputs (
  game_id text PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  contract_version integer NOT NULL DEFAULT 1,
  outcome_event_sequence integer NOT NULL,
  outcome_event_hash text NOT NULL,
  input_hash text NOT NULL,
  input jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_retrospective_inputs_version_check CHECK (contract_version = 1),
  CONSTRAINT game_retrospective_inputs_source_check CHECK (
    outcome_event_sequence > 0
    AND outcome_event_hash ~ '^sha256:[0-9a-f]{64}$'
    AND input_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT game_retrospective_inputs_shape_check CHECK (
    jsonb_typeof(input) = 'object'
    AND input ?& ARRAY['version', 'outcome', 'sections', 'dialogue']
    AND (input - 'version' - 'outcome' - 'sections' - 'dialogue') = '{}'::jsonb
    AND (input->'version') IS NOT DISTINCT FROM '1'::jsonb
    AND jsonb_typeof(input->'sections') = 'array'
    AND jsonb_typeof(input->'dialogue') = 'array'
    AND jsonb_typeof(input->'outcome') = 'object'
    AND (input->'outcome') ?& ARRAY['gameId', 'gameKind', 'eventSequence', 'eventHash']
    AND ((input->'outcome') - 'gameId' - 'gameKind' - 'eventSequence' - 'eventHash') = '{}'::jsonb
    AND jsonb_typeof(input->'outcome'->'eventSequence') = 'number'
    AND (input->'outcome'->>'gameId') IS NOT DISTINCT FROM game_id
    AND ((input->'outcome'->>'gameKind') IN ('influence', 'werewolf')) IS TRUE
    AND (input->'outcome'->>'eventSequence') IS NOT DISTINCT FROM outcome_event_sequence::text
    AND (input->'outcome'->>'eventHash') IS NOT DISTINCT FROM outcome_event_hash
  ),
  CONSTRAINT game_retrospective_inputs_size_check CHECK (octet_length(input::text) <= 262144)
);
--> statement-breakpoint
CREATE FUNCTION immutable_game_retrospective_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Game retrospective inputs are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_game_retrospective_input BEFORE UPDATE ON game_retrospective_inputs
FOR EACH ROW EXECUTE FUNCTION immutable_game_retrospective_input();
