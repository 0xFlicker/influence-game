CREATE TABLE "visual_character_variants" (
  "id" text PRIMARY KEY,
  "game_id" text NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "player_id" text NOT NULL,
  "source_artifact_id" text NOT NULL REFERENCES "visual_artifacts"("id"),
  "artifact_id" text NOT NULL REFERENCES "visual_artifacts"("id"),
  "revision" text NOT NULL,
  "generation" text NOT NULL,
  "head" jsonb NOT NULL,
  "created_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "visual_character_variants_identity_unique" UNIQUE ("game_id", "player_id", "source_artifact_id", "revision", "generation")
);

