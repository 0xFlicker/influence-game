ALTER TABLE "games"
	ADD COLUMN "cognitive_artifact_capture_version" integer DEFAULT 0 NOT NULL;

CREATE TABLE "game_cognitive_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"capture_version" integer DEFAULT 1 NOT NULL,
	"event_sequence" integer,
	"artifact_type" text NOT NULL,
	"actor_role" text NOT NULL,
	"actor_player_id" text,
	"actor_user_id" text,
	"actor_agent_profile_id" text,
	"action" text NOT NULL,
	"phase" text,
	"round" integer,
	"visibility_status" text DEFAULT 'active' NOT NULL,
	"payload_byte_length" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"diagnostics" jsonb,
	"retention_class" text DEFAULT 'debug' NOT NULL,
	"redaction_status" text DEFAULT 'active' NOT NULL,
	"expires_at" text,
	"redacted_at" text,
	"created_at" text DEFAULT now()::text NOT NULL
);

CREATE TABLE "game_cognitive_artifact_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"artifact_id" text,
	"game_id" text NOT NULL,
	"actor_player_id" text,
	"artifact_type" text,
	"accessor_user_id" text,
	"auth_profile" text,
	"purpose" text NOT NULL,
	"outcome" text NOT NULL,
	"denial_reason" text,
	"read_at" text DEFAULT now()::text NOT NULL
);

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_game_id_games_id_fk"
	FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_actor_player_id_game_players_id_fk"
	FOREIGN KEY ("actor_player_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_actor_user_id_users_id_fk"
	FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_actor_agent_profile_id_agent_profiles_id_fk"
	FOREIGN KEY ("actor_agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_event_boundary_fk"
	FOREIGN KEY ("game_id","event_sequence") REFERENCES "public"."game_events"("game_id","sequence") ON DELETE no action ON UPDATE no action;

ALTER TABLE "game_cognitive_artifact_reads"
	ADD CONSTRAINT "cognitive_artifact_reads_artifact_fk"
	FOREIGN KEY ("artifact_id") REFERENCES "public"."game_cognitive_artifacts"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "game_cognitive_artifact_reads"
	ADD CONSTRAINT "game_cognitive_artifact_reads_game_id_games_id_fk"
	FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "game_cognitive_artifact_reads"
	ADD CONSTRAINT "game_cognitive_artifact_reads_actor_player_id_game_players_id_fk"
	FOREIGN KEY ("actor_player_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "game_cognitive_artifact_reads"
	ADD CONSTRAINT "game_cognitive_artifact_reads_accessor_user_id_users_id_fk"
	FOREIGN KEY ("accessor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "game_cognitive_artifacts_game_type_actor_idx"
	ON "game_cognitive_artifacts" USING btree ("game_id","artifact_type","actor_player_id");

CREATE INDEX "game_cognitive_artifacts_game_phase_round_idx"
	ON "game_cognitive_artifacts" USING btree ("game_id","phase","round");

CREATE INDEX "game_cognitive_artifacts_game_action_idx"
	ON "game_cognitive_artifacts" USING btree ("game_id","action");

CREATE INDEX "game_cognitive_artifacts_event_sequence_idx"
	ON "game_cognitive_artifacts" USING btree ("game_id","event_sequence");

CREATE INDEX "game_cognitive_artifact_reads_artifact_id_idx"
	ON "game_cognitive_artifact_reads" USING btree ("artifact_id");

CREATE INDEX "game_cognitive_artifact_reads_game_id_idx"
	ON "game_cognitive_artifact_reads" USING btree ("game_id");

CREATE INDEX "game_cognitive_artifact_reads_accessor_user_id_idx"
	ON "game_cognitive_artifact_reads" USING btree ("accessor_user_id");

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_capture_version_check"
	CHECK ("capture_version" > 0);

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_artifact_type_check"
	CHECK ("artifact_type" IN ('reasoning', 'thinking', 'strategy'));

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_actor_role_check"
	CHECK ("actor_role" IN ('player', 'juror', 'house', 'system', 'producer'));

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_visibility_status_check"
	CHECK ("visibility_status" IN ('active', 'capture_degraded'));

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_retention_class_check"
	CHECK ("retention_class" IN ('debug', 'audit', 'legal_hold'));

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_redaction_status_check"
	CHECK ("redaction_status" IN ('active', 'expired', 'redacted'));

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_event_sequence_check"
	CHECK ("event_sequence" IS NULL OR "event_sequence" > 0);

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_round_check"
	CHECK ("round" IS NULL OR "round" > 0);

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_payload_byte_length_check"
	CHECK ("payload_byte_length" >= 0);

ALTER TABLE "game_cognitive_artifact_reads"
	ADD CONSTRAINT "game_cognitive_artifact_reads_artifact_type_check"
	CHECK ("artifact_type" IS NULL OR "artifact_type" IN ('reasoning', 'thinking', 'strategy'));

ALTER TABLE "game_cognitive_artifact_reads"
	ADD CONSTRAINT "game_cognitive_artifact_reads_outcome_check"
	CHECK ("outcome" IN ('allowed', 'denied', 'not_captured', 'not_captured_for_game', 'capture_degraded', 'expired', 'redacted'));
