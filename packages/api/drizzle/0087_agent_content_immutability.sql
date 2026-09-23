ALTER TABLE agent_profiles ADD CONSTRAINT agent_profiles_content_revision_fk FOREIGN KEY (content_revision_id) REFERENCES agent_content_revisions(id) ON DELETE RESTRICT;
CREATE INDEX agent_content_revisions_profile_idx ON agent_content_revisions(agent_profile_id, created_at);
CREATE INDEX agent_moderation_pending_idx ON agent_moderation_reviews(status, created_at);
CREATE FUNCTION reject_agent_content_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Accepted character evidence is immutable'; END;
$$;
CREATE TRIGGER agent_content_revisions_immutable BEFORE UPDATE ON agent_content_revisions FOR EACH ROW EXECUTE FUNCTION reject_agent_content_mutation();
CREATE TRIGGER agent_content_assets_immutable BEFORE UPDATE ON agent_content_assets FOR EACH ROW EXECUTE FUNCTION reject_agent_content_mutation();
CREATE TRIGGER agent_content_submissions_immutable BEFORE UPDATE ON agent_content_submissions FOR EACH ROW EXECUTE FUNCTION reject_agent_content_mutation();
