CREATE TABLE house_share_accounts (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  analytics_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE
);
--> statement-breakpoint
ALTER TABLE house_share_links ADD COLUMN owner_id text REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE house_share_links ADD COLUMN analytics_id uuid UNIQUE;
--> statement-breakpoint
DROP INDEX house_share_links_path_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX house_share_links_path_unique ON house_share_links (path) WHERE analytics_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX house_share_links_owner_path_unique ON house_share_links (owner_id, path) WHERE owner_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE house_share_opens (
  id uuid PRIMARY KEY,
  link_code text NOT NULL REFERENCES house_share_links(code),
  opened_at timestamptz NOT NULL DEFAULT now(),
  claimed boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE INDEX house_share_opens_link_idx ON house_share_opens (link_code);
--> statement-breakpoint
ALTER TABLE campaign_conversion_events ADD COLUMN share_open_id uuid REFERENCES house_share_opens(id);
--> statement-breakpoint
CREATE UNIQUE INDEX campaign_conversion_events_signup_share_open_unique
  ON campaign_conversion_events (share_open_id)
  WHERE event_name = 'signup_completed' AND share_open_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX campaign_conversion_events_share_open_idx
  ON campaign_conversion_events (share_open_id, event_name) WHERE share_open_id IS NOT NULL;
