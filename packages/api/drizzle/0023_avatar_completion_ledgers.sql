CREATE TABLE IF NOT EXISTS "avatar_generation_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "agent_profile_id" text NOT NULL,
  "purpose" text NOT NULL,
  "status" text NOT NULL,
  "trigger_source" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'katana',
  "model" text NOT NULL DEFAULT 'gen',
  "provider_request_id" text,
  "prompt_hash" text,
  "estimated_cost_microusd" integer,
  "failure_code" text,
  "failure_message" text,
  "safe_metadata" jsonb,
  "created_at" text NOT NULL DEFAULT now()::text,
  "updated_at" text NOT NULL DEFAULT now()::text,
  "completed_at" text,
  CONSTRAINT "avatar_generation_requests_purpose_check"
    CHECK ("purpose" IN ('agent_profile_completion')),
  CONSTRAINT "avatar_generation_requests_status_check"
    CHECK ("status" IN ('queued', 'processing', 'completed', 'skipped', 'failed')),
  CONSTRAINT "avatar_generation_requests_trigger_source_check"
    CHECK ("trigger_source" IN ('web_user_prompt', 'mcp_create_default'))
);

CREATE INDEX IF NOT EXISTS "avatar_generation_requests_user_idx"
  ON "avatar_generation_requests" USING btree ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "avatar_generation_requests_agent_idx"
  ON "avatar_generation_requests" USING btree ("agent_profile_id", "created_at");

CREATE INDEX IF NOT EXISTS "avatar_generation_requests_status_idx"
  ON "avatar_generation_requests" USING btree ("status", "updated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "avatar_generation_requests_completion_active_unique"
  ON "avatar_generation_requests" USING btree ("user_id", "agent_profile_id", "purpose")
  WHERE "status" IN ('queued', 'processing', 'completed');

CREATE TABLE IF NOT EXISTS "avatar_change_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "agent_profile_id" text NOT NULL,
  "generation_request_id" text REFERENCES "avatar_generation_requests"("id"),
  "source" text NOT NULL,
  "status" text NOT NULL,
  "actor_user_id" text REFERENCES "users"("id"),
  "previous_avatar_url" text,
  "new_avatar_url" text,
  "safe_metadata" jsonb,
  "created_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "avatar_change_events_source_check"
    CHECK ("source" IN ('web_upload', 'web_generated_completion', 'web_manual_update', 'mcp_create_default', 'mcp_provided_avatar', 'mcp_update', 'backend_generated_completion', 'generation_skipped', 'generation_failed', 'producer_action')),
  CONSTRAINT "avatar_change_events_status_check"
    CHECK ("status" IN ('completed', 'skipped', 'failed'))
);

CREATE INDEX IF NOT EXISTS "avatar_change_events_user_idx"
  ON "avatar_change_events" USING btree ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "avatar_change_events_agent_idx"
  ON "avatar_change_events" USING btree ("agent_profile_id", "created_at");

CREATE INDEX IF NOT EXISTS "avatar_change_events_source_idx"
  ON "avatar_change_events" USING btree ("source", "created_at");
