ALTER TABLE user_analytics_preferences ADD COLUMN advertising boolean;
ALTER TABLE user_analytics_preferences ADD COLUMN advertising_explicit boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Preserve old refusals; acceptance of PostHog did not disclose ad sharing.
UPDATE user_analytics_preferences SET advertising = false WHERE analytics = false;
UPDATE user_analytics_preferences SET web_user_agent = NULL;
UPDATE campaign_conversion_events SET
 client_user_agent = NULL, google_ad_user_data_granted = false,
 platform_status = CASE WHEN platform_status = 'delivered' THEN platform_status ELSE 'suppressed' END,
 google_status = CASE WHEN google_status = 'delivered' THEN google_status ELSE 'suppressed' END,
 tiktok_status = CASE WHEN tiktok_status = 'delivered' THEN tiktok_status ELSE 'suppressed' END,
 x_status = CASE WHEN x_status = 'delivered' THEN x_status ELSE 'suppressed' END,
 google_next_poll_at = NULL;
