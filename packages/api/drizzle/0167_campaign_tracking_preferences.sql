CREATE TABLE "user_analytics_preferences" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "analytics" boolean NOT NULL DEFAULT false,
  "updated_at" text NOT NULL DEFAULT now()::text
);
--> statement-breakpoint
-- Earlier rows have no recorded tracking permission. Never backfill delivery.
UPDATE campaign_conversion_events SET posthog_status = 'suppressed', platform_status = 'suppressed', attribution = NULL;
--> statement-breakpoint
DELETE FROM user_campaign_attribution;
