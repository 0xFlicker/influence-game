ALTER TABLE "visual_render_operations" ADD COLUMN IF NOT EXISTS "budget_start_generation" integer DEFAULT 1 NOT NULL;
ALTER TABLE "visual_scenes" ADD COLUMN IF NOT EXISTS "candidate_artifact_id" text REFERENCES "visual_artifacts"("id");
ALTER TABLE "visual_scenes" ADD COLUMN IF NOT EXISTS "repair_mode" text DEFAULT 'regenerate' NOT NULL;
ALTER TABLE "visual_render_operations" ADD COLUMN IF NOT EXISTS "scene_id" text REFERENCES "visual_scenes"("id");
ALTER TABLE "visual_scenes" ADD COLUMN IF NOT EXISTS "repair_budget_used" boolean DEFAULT false NOT NULL;
