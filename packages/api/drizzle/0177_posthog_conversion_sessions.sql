ALTER TABLE campaign_conversion_events ADD COLUMN posthog_session_id uuid;
--> statement-breakpoint
CREATE TABLE campaign_agent_ready_sessions (
  agent_profile_id text PRIMARY KEY REFERENCES agent_profiles(id) ON DELETE CASCADE,
  content_revision_id text NOT NULL REFERENCES agent_content_revisions(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user_analytics_preferences(user_id) ON DELETE CASCADE,
  session_id uuid NOT NULL
);
--> statement-breakpoint
CREATE INDEX campaign_agent_ready_sessions_user_idx ON campaign_agent_ready_sessions(user_id);
