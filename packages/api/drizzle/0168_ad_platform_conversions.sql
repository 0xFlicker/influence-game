-- Existing events are never backfilled to newly added destinations.
ALTER TABLE user_analytics_preferences ADD COLUMN analytics_explicit boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE campaign_conversion_events
  ADD COLUMN google_status text NOT NULL DEFAULT 'suppressed',
  ADD COLUMN google_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN google_last_error text,
  ADD COLUMN google_ad_user_data_granted boolean NOT NULL DEFAULT false,
  ADD COLUMN google_destination jsonb,
  ADD COLUMN google_request_id text,
  ADD COLUMN google_accepted_at text,
  ADD COLUMN google_poll_count integer NOT NULL DEFAULT 0,
  ADD COLUMN google_next_poll_at text,
  ADD COLUMN tiktok_status text NOT NULL DEFAULT 'suppressed',
  ADD COLUMN tiktok_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN tiktok_pixel_id text,
  ADD COLUMN tiktok_last_error text,
  ADD COLUMN x_status text NOT NULL DEFAULT 'suppressed',
  ADD COLUMN x_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN x_pixel_id text,
  ADD COLUMN x_event_id text,
  ADD COLUMN x_last_error text;
