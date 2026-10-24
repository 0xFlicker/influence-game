ALTER TABLE provider_call_attempts ADD COLUMN rate_card jsonb;

--> statement-breakpoint
ALTER TABLE provider_call_attempts ADD COLUMN authority_kind text NOT NULL DEFAULT 'game' CHECK (authority_kind IN ('game', 'episode_copy'));
--> statement-breakpoint
ALTER TABLE provider_call_attempts ADD COLUMN game_owner_epoch text GENERATED ALWAYS AS (CASE WHEN authority_kind = 'game' THEN owner_epoch END) STORED;
--> statement-breakpoint
ALTER TABLE provider_call_attempts DROP CONSTRAINT provider_call_attempts_game_owner_fk;
--> statement-breakpoint
ALTER TABLE provider_call_attempts ADD CONSTRAINT provider_call_attempts_game_owner_fk FOREIGN KEY (game_id, game_owner_epoch) REFERENCES game_run_owners(game_id, owner_epoch);

--> statement-breakpoint
ALTER TABLE provider_attempt_evidence_outbox ADD COLUMN authority_kind text NOT NULL DEFAULT 'game' CHECK (authority_kind IN ('game', 'episode_copy'));
--> statement-breakpoint
ALTER TABLE provider_attempt_evidence_outbox ADD COLUMN game_owner_epoch text GENERATED ALWAYS AS (CASE WHEN authority_kind = 'game' THEN owner_epoch END) STORED;
--> statement-breakpoint
ALTER TABLE provider_attempt_evidence_outbox DROP CONSTRAINT provider_attempt_evidence_outbox_game_owner_fk;
--> statement-breakpoint
ALTER TABLE provider_attempt_evidence_outbox ADD CONSTRAINT provider_attempt_evidence_outbox_game_owner_fk FOREIGN KEY (game_id, game_owner_epoch) REFERENCES game_run_owners(game_id, owner_epoch);

--> statement-breakpoint
ALTER TABLE provider_logical_calls ADD COLUMN preferred_catalog_id text;

--> statement-breakpoint
ALTER TABLE game_evidence_manifests ADD COLUMN authority_kind text NOT NULL DEFAULT 'game' CHECK (authority_kind IN ('game', 'episode_copy'));
--> statement-breakpoint
ALTER TABLE game_evidence_manifests ADD COLUMN game_owner_epoch text GENERATED ALWAYS AS (CASE WHEN authority_kind = 'game' THEN owner_epoch END) STORED;
--> statement-breakpoint
ALTER TABLE game_evidence_manifests DROP CONSTRAINT IF EXISTS game_evidence_owner_epoch_fk;
--> statement-breakpoint
ALTER TABLE game_evidence_manifests DROP CONSTRAINT IF EXISTS game_evidence_manifests_owner_epoch_game_run_owners_owner_epoch;
--> statement-breakpoint
ALTER TABLE game_evidence_manifests DROP CONSTRAINT game_evidence_manifests_game_owner_fk;
--> statement-breakpoint
ALTER TABLE game_evidence_manifests ADD CONSTRAINT game_evidence_owner_epoch_fk FOREIGN KEY (game_owner_epoch) REFERENCES game_run_owners(owner_epoch);
--> statement-breakpoint
ALTER TABLE game_evidence_manifests ADD CONSTRAINT game_evidence_manifests_game_owner_fk FOREIGN KEY (game_id, game_owner_epoch) REFERENCES game_run_owners(game_id, owner_epoch);
