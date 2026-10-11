CREATE TABLE production_moment_annotations (
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  moment_key text NOT NULL,
  tags jsonb NOT NULL,
  revision integer NOT NULL,
  updated_by_id text NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, moment_key),
  CONSTRAINT production_moment_annotations_revision_positive CHECK (revision > 0),
  CONSTRAINT production_moment_annotations_tags_object CHECK (jsonb_typeof(tags) = 'object')
);
