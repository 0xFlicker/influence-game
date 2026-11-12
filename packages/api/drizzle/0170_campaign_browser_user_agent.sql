ALTER TABLE user_analytics_preferences ADD COLUMN web_user_agent text;
--> statement-breakpoint
ALTER TABLE campaign_conversion_events ADD COLUMN client_user_agent text;
