ALTER TABLE "visual_render_operations" ADD COLUMN "request" jsonb;
CREATE TABLE "visual_operation_events" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "event_key" text NOT NULL,
  "event" jsonb NOT NULL,
  "evidence" jsonb,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "visual_operation_events_key_unique" UNIQUE("game_id", "event_key")
);
