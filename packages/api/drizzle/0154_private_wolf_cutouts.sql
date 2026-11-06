ALTER TABLE character_cutouts ADD COLUMN private_source boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE visual_character_cutouts (
  source_artifact_id text PRIMARY KEY REFERENCES visual_artifacts(id) ON DELETE CASCADE,
  artifact_id text NOT NULL REFERENCES visual_artifacts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
