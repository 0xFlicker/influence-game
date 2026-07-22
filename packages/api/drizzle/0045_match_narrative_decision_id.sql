-- Forward-path durable decisionId for match narrative exact correlation.
-- Nullable; never backfilled on historical rows.

ALTER TABLE "game_cognitive_artifacts" ADD COLUMN "decision_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_cognitive_artifacts_game_decision_id_idx"
  ON "game_cognitive_artifacts" USING btree ("game_id","decision_id");
