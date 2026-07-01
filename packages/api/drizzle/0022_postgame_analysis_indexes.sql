CREATE INDEX IF NOT EXISTS "games_created_by_id_idx"
	ON "games" USING btree ("created_by_id");

CREATE INDEX IF NOT EXISTS "games_status_ended_at_idx"
	ON "games" USING btree ("status", "ended_at");

CREATE INDEX IF NOT EXISTS "agent_profiles_user_id_idx"
	ON "agent_profiles" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "agent_profiles_name_idx"
	ON "agent_profiles" USING btree ("name");

CREATE INDEX IF NOT EXISTS "game_players_game_id_idx"
	ON "game_players" USING btree ("game_id");

CREATE INDEX IF NOT EXISTS "game_players_user_id_idx"
	ON "game_players" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "game_players_agent_profile_id_idx"
	ON "game_players" USING btree ("agent_profile_id");
