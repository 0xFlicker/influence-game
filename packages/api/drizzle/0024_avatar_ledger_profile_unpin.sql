ALTER TABLE "avatar_generation_requests"
  DROP CONSTRAINT IF EXISTS "avatar_generation_requests_agent_profile_id_agent_profiles_id_fk";
ALTER TABLE "avatar_generation_requests"
  DROP CONSTRAINT IF EXISTS "avatar_generation_requests_agent_profile_id_fkey";

ALTER TABLE "avatar_change_events"
  DROP CONSTRAINT IF EXISTS "avatar_change_events_agent_profile_id_agent_profiles_id_fk";
ALTER TABLE "avatar_change_events"
  DROP CONSTRAINT IF EXISTS "avatar_change_events_agent_profile_id_fkey";
