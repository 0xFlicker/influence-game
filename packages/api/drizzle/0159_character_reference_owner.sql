ALTER TABLE character_reference_jobs ADD COLUMN agent_id text REFERENCES agent_profiles(id), ADD COLUMN draft_scope text;
