ALTER TABLE agent_profiles ADD COLUMN visual_design text, ADD COLUMN portrait_crop jsonb, ADD COLUMN content_revision_id text;
--> statement-breakpoint
CREATE TABLE agent_content_assets (hash text PRIMARY KEY, bytes bytea NOT NULL);
CREATE TABLE agent_content_revisions (id text PRIMARY KEY, agent_profile_id text NOT NULL, user_id text NOT NULL REFERENCES users(id), competitive_revision_id text, fingerprint text NOT NULL, snapshot jsonb NOT NULL, created_at text NOT NULL DEFAULT now()::text);
CREATE TABLE agent_moderation_reviews (id text PRIMARY KEY, content_revision_id text NOT NULL REFERENCES agent_content_revisions(id), status text NOT NULL DEFAULT 'pending', created_at text NOT NULL DEFAULT now()::text);
CREATE UNIQUE INDEX agent_moderation_revision_unique ON agent_moderation_reviews(content_revision_id);
CREATE TABLE agent_content_submissions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), agent_profile_id text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL);
