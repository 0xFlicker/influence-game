ALTER TABLE character_cutout_demands ALTER COLUMN game_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE character_cutout_demands ADD COLUMN agent_profile_id text REFERENCES agent_profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX character_cutout_demands_agent_source ON character_cutout_demands(agent_profile_id,source_key,recipe);
--> statement-breakpoint
ALTER TABLE character_cutout_demands ADD CONSTRAINT character_cutout_demands_owner CHECK ((game_id IS NULL) <> (agent_profile_id IS NULL));
