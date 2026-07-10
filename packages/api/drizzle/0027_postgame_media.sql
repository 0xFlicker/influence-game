CREATE TABLE IF NOT EXISTS "game_postgame_media" (
  "game_id" text NOT NULL REFERENCES "games"("id"),
  "media_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "render_version" integer NOT NULL DEFAULT 1,
  "attempt_number" integer NOT NULL DEFAULT 1,
  "worker_id_hash" text,
  "lease_token_hash" text,
  "lease_expires_at" text,
  "claimed_at" text,
  "attempt_started_at" text,
  "attempt_finished_at" text,
  "failure_category" text,
  "failure_message" text,
  "render_duration_ms" integer,
  "render_input_snapshot" jsonb NOT NULL,
  "render_input_snapshot_hash" text NOT NULL,
  "render_input_snapshot_version" integer NOT NULL,
  "renderer_version" text NOT NULL,
  "timing_contract_version" text NOT NULL,
  "music_asset_id" text NOT NULL,
  "artifact_metadata" jsonb,
  "cue_metadata" jsonb,
  "diagnostics" jsonb,
  "current_ready_render_version" integer,
  "current_ready_duration_ms" integer,
  "current_ready_artifact_metadata" jsonb,
  "current_ready_published_at" text,
  "created_at" text NOT NULL DEFAULT now()::text,
  "updated_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "game_postgame_media_game_id_media_type_pk"
    PRIMARY KEY ("game_id", "media_type"),
  CONSTRAINT "game_postgame_media_type_check"
    CHECK ("media_type" IN ('house_highlights_trailer')),
  CONSTRAINT "game_postgame_media_status_check"
    CHECK ("status" IN ('waiting_inputs', 'waiting_music', 'queued', 'claimed', 'rendering', 'composing', 'uploading', 'ready', 'failed')),
  CONSTRAINT "game_postgame_media_render_version_check"
    CHECK ("render_version" > 0 AND "attempt_number" > 0),
  CONSTRAINT "game_postgame_media_duration_check"
    CHECK ("render_duration_ms" IS NULL OR "render_duration_ms" >= 0),
  CONSTRAINT "game_postgame_media_snapshot_version_check"
    CHECK ("render_input_snapshot_version" > 0),
  CONSTRAINT "game_postgame_media_current_ready_check"
    CHECK (
      ("current_ready_render_version" IS NULL
        AND "current_ready_duration_ms" IS NULL
        AND "current_ready_artifact_metadata" IS NULL
        AND "current_ready_published_at" IS NULL)
      OR ("current_ready_render_version" IS NOT NULL
        AND "current_ready_duration_ms" IS NOT NULL
        AND "current_ready_artifact_metadata" IS NOT NULL
        AND "current_ready_published_at" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "game_postgame_media_status_idx"
  ON "game_postgame_media" USING btree ("status", "updated_at");
