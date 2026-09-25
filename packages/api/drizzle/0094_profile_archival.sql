CREATE TABLE agent_profile_lifecycle_actions (
  id text PRIMARY KEY,
  agent_profile_id text NOT NULL REFERENCES agent_profiles(id),
  actor_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL CONSTRAINT agent_profile_lifecycle_kind_check CHECK (kind IN ('archive', 'restore')),
  reason text NOT NULL,
  profile_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_profile_lifecycle_profile_idx ON agent_profile_lifecycle_actions(agent_profile_id, created_at);
CREATE TRIGGER agent_profile_lifecycle_immutable BEFORE UPDATE OR DELETE ON agent_profile_lifecycle_actions
  FOR EACH ROW EXECUTE FUNCTION reject_agent_content_mutation();
