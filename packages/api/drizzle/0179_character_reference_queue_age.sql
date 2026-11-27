ALTER TABLE "character_reference_jobs" ADD COLUMN "queued_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE "character_reference_jobs" SET "queued_at" = "updated_at"::timestamptz;
