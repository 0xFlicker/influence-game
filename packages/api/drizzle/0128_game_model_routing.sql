ALTER TABLE agent_profiles ADD COLUMN model_preference jsonb NOT NULL DEFAULT '"default"'::jsonb;
--> statement-breakpoint
ALTER TABLE game_players ADD COLUMN model_preference jsonb NOT NULL DEFAULT '"default"'::jsonb;
--> statement-breakpoint
ALTER TABLE werewolf_lobby_seats ADD COLUMN model_preference jsonb NOT NULL DEFAULT '"default"'::jsonb;
--> statement-breakpoint
ALTER TABLE provider_call_attempts ADD COLUMN fallback_budget_key text;
--> statement-breakpoint
CREATE INDEX provider_attempt_fallback_budget_idx ON provider_call_attempts (game_id, fallback_budget_key) WHERE fallback_budget_key IS NOT NULL;
