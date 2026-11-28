CREATE TABLE "discord_announcement_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game_id" text NOT NULL REFERENCES "games" ("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "channel_id" text NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "lease" uuid,
  "lease_until" timestamptz,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "message_id" text,
  CONSTRAINT "discord_announcement_job_transition_unique" UNIQUE ("game_id", "kind"),
  CONSTRAINT "discord_announcement_job_kind_check" CHECK ("kind" IN ('start', 'finish')),
  CONSTRAINT "discord_announcement_job_state_check" CHECK ("state" IN ('pending', 'sending', 'posted', 'suppressed', 'failed', 'unconfirmed')),
  CONSTRAINT "discord_announcement_job_receipt_check" CHECK (("state" = 'posted') = ("message_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "discord_announcement_job_pending_idx" ON "discord_announcement_jobs" ("channel_id", "next_attempt_at", "created_at") WHERE "state" = 'pending';
--> statement-breakpoint
CREATE INDEX "discord_announcement_job_sending_idx" ON "discord_announcement_jobs" ("channel_id", "lease_until") WHERE "state" = 'sending';
