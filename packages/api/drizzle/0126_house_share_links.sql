CREATE TABLE house_share_links (
  code text PRIMARY KEY CHECK (code ~ '^[1-9A-HJ-NP-Za-km-z]{10}$'),
  path text NOT NULL CHECK (length(path) <= 2048 AND path LIKE '/%' AND path NOT LIKE '//%'),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX house_share_links_path_unique ON house_share_links (path);
--> statement-breakpoint
CREATE TABLE house_share_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX house_share_rate_limits_expiry ON house_share_rate_limits (reset_at);
