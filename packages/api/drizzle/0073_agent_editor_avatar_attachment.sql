ALTER TABLE "avatar_generation_requests" ALTER COLUMN "agent_profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "creation_request_id" text;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "creation_payload_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profiles_user_creation_request_unique" ON "agent_profiles" USING btree ("user_id","creation_request_id") WHERE "agent_profiles"."creation_request_id" IS NOT NULL;--> statement-breakpoint
UPDATE "avatar_generation_requests"
SET "agent_profile_id" = NULL
WHERE "trigger_source" = 'web_ai_help_draft'
  AND "agent_profile_id" LIKE 'draft-%'
  AND "safe_metadata" ->> 'consumedAt' IS NULL;
