-- Historical snapshots have no proven parentage. Do not infer it from timestamps.
ALTER TABLE agent_content_revisions ADD COLUMN parent_revision_id text REFERENCES agent_content_revisions(id) ON DELETE RESTRICT;
ALTER TABLE agent_content_revisions ADD COLUMN ancestry_known boolean NOT NULL DEFAULT false;
ALTER TABLE agent_content_revisions ALTER COLUMN ancestry_known SET DEFAULT true;
ALTER TABLE agent_moderation_reviews ADD COLUMN route text NOT NULL DEFAULT 'ordinary' CHECK (route IN ('ordinary', 'escalated'));
ALTER TABLE agent_moderation_reviews ADD COLUMN disposition text NOT NULL DEFAULT 'allowed' CHECK (disposition IN ('allowed', 'rejected'));
ALTER TABLE agent_moderation_reviews ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK (version >= 0);
ALTER TABLE agent_moderation_reviews ADD COLUMN cycle integer NOT NULL DEFAULT 1 CHECK (cycle > 0);
ALTER TABLE agent_moderation_reviews ADD COLUMN flagged boolean NOT NULL DEFAULT false;
CREATE TABLE moderation_claims (
  reviewer_id text PRIMARY KEY REFERENCES users(id),
  review_id text NOT NULL REFERENCES agent_moderation_reviews(id),
  token text NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT moderation_claims_expiry CHECK (expires_at > acquired_at AND expires_at <= acquired_at + interval '30 minutes')
);
CREATE UNIQUE INDEX moderation_claims_review_unique ON moderation_claims(review_id);
CREATE TABLE moderation_actions (
  id text PRIMARY KEY,
  review_id text NOT NULL REFERENCES agent_moderation_reviews(id),
  actor_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  cycle integer NOT NULL CHECK (cycle > 0),
  request_hash text NOT NULL,
  reason text,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_review_idx ON moderation_actions(review_id, created_at);
CREATE INDEX moderation_actions_actor_idx ON moderation_actions(actor_id, created_at);
CREATE TRIGGER moderation_actions_immutable BEFORE UPDATE OR DELETE ON moderation_actions
  FOR EACH ROW EXECUTE FUNCTION reject_agent_content_mutation();
