CREATE TABLE "visual_artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "content_hash" text NOT NULL,
  "image" bytea NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "visual_artifacts_content_unique" UNIQUE("game_id", "content_hash")
);
--> statement-breakpoint
CREATE TABLE "visual_scenes" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "room_id" text NOT NULL,
  "boundary_sequence" integer NOT NULL,
  "plan" jsonb NOT NULL,
  "plan_hash" text NOT NULL,
  "status" text DEFAULT 'preparing' NOT NULL,
  "image_artifact_id" text REFERENCES "visual_artifacts"("id"),
  "annotated_artifact_id" text REFERENCES "visual_artifacts"("id"),
  "anchors" jsonb,
  "failure" text,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "visual_scenes_boundary_unique" UNIQUE("game_id", "room_id", "boundary_sequence"),
  CONSTRAINT "visual_scenes_status_check" CHECK ("status" IN ('preparing', 'ready', 'failed')),
  CONSTRAINT "visual_scenes_ready_check" CHECK ("status" <> 'ready' OR ("image_artifact_id" IS NOT NULL AND "annotated_artifact_id" IS NOT NULL AND "anchors" IS NOT NULL))
);
