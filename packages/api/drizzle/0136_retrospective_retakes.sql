CREATE TABLE "production_retrospective_retakes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "actor_id" text NOT NULL,
  "source_event_sequence" integer NOT NULL,
  "source_event_hash" text NOT NULL,
  "track_id" uuid NOT NULL UNIQUE REFERENCES "game_audio_tracks"("id") ON DELETE CASCADE,
  "document_object" jsonb NOT NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "retrospective_retakes_source_check" CHECK (source_event_sequence > 0 AND source_event_hash ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "retrospective_retakes_source_idx" ON "production_retrospective_retakes" (game_id, source_event_sequence, published_at);

--> statement-breakpoint
ALTER TABLE production_retrospective_retakes ADD CONSTRAINT "payload_a71b9b545ea4_check" CHECK ("production_retrospective_retakes"."document_object" IS NULL OR ((
      jsonb_typeof("production_retrospective_retakes"."document_object") = 'object'
      AND "production_retrospective_retakes"."document_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
      AND ("production_retrospective_retakes"."document_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
      AND "production_retrospective_retakes"."document_object"->>'storage' = 'private-payload-v1' AND "production_retrospective_retakes"."document_object"->>'codec' = 'json-gzip'
      AND "production_retrospective_retakes"."document_object"->>'sha256' ~ '^[a-f0-9]{64}$' AND "production_retrospective_retakes"."document_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
      AND "production_retrospective_retakes"."document_object"->>'key' = 'payloads/v1/json-gzip/' || ("production_retrospective_retakes"."document_object"->>'sha256')
      AND jsonb_typeof("production_retrospective_retakes"."document_object"->'byteLength') = 'number' AND ("production_retrospective_retakes"."document_object"->>'byteLength')::bigint >= 0
      AND jsonb_typeof("production_retrospective_retakes"."document_object"->'storedByteLength') = 'number' AND ("production_retrospective_retakes"."document_object"->>'storedByteLength')::bigint >= 0
    ) IS TRUE));
