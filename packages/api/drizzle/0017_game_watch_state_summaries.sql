CREATE TABLE "game_watch_state_summaries" (
	"game_id" text PRIMARY KEY NOT NULL,
	"slug" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"current_round" integer DEFAULT 0 NOT NULL,
	"current_phase" text DEFAULT 'INIT' NOT NULL,
	"max_rounds" integer DEFAULT 10 NOT NULL,
	"total_players" integer DEFAULT 0 NOT NULL,
	"alive_players" integer DEFAULT 0 NOT NULL,
	"eliminated_players" integer DEFAULT 0 NOT NULL,
	"unknown_players" integer DEFAULT 0 NOT NULL,
	"event_cursor_sequence" integer DEFAULT 0 NOT NULL,
	"event_cursor_source" text DEFAULT 'none' NOT NULL,
	"event_cursor_event_type" text,
	"event_cursor_created_at" text,
	"projection_availability" text DEFAULT 'unavailable' NOT NULL,
	"projection_event_log_status" text DEFAULT 'empty' NOT NULL,
	"projection_status" text DEFAULT 'empty' NOT NULL,
	"projection_event_count" integer DEFAULT 0 NOT NULL,
	"projection_trusted_event_count" integer DEFAULT 0 NOT NULL,
	"projection_valid_prefix_length" integer DEFAULT 0 NOT NULL,
	"projection_last_trusted_sequence" integer DEFAULT 0 NOT NULL,
	"projection_first_invalid_sequence" integer,
	"projection_persisted_head" jsonb,
	"projection_diagnostics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"final_status" text DEFAULT 'not_final' NOT NULL,
	"winner_id" text,
	"winner_name" text,
	"winner_method" text,
	"winner_source" text,
	"rounds_played" integer,
	"last_refresh_reason" text,
	"refreshed_at" text DEFAULT now()::text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL
);

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_game_id_games_id_fk"
	FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "game_watch_state_summaries_status_idx"
	ON "game_watch_state_summaries" USING btree ("status");

CREATE INDEX "game_watch_state_summaries_source_idx"
	ON "game_watch_state_summaries" USING btree ("source");

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_schema_version_check"
	CHECK ("schema_version" > 0);

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_status_check"
	CHECK ("status" IN ('waiting', 'in_progress', 'completed', 'cancelled', 'suspended'));

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_source_check"
	CHECK ("source" IN ('durable_projection', 'degraded', 'best_available_terminal_result', 'pre_kernel_empty'));

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_current_round_check"
	CHECK ("current_round" >= 0);

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_max_rounds_check"
	CHECK ("max_rounds" > 0);

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_counts_check"
	CHECK (
		"total_players" >= 0
		AND "alive_players" >= 0
		AND "eliminated_players" >= 0
		AND "unknown_players" >= 0
		AND "total_players" = "alive_players" + "eliminated_players" + "unknown_players"
	);

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_event_cursor_sequence_check"
	CHECK ("event_cursor_sequence" >= 0);

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_event_cursor_source_check"
	CHECK ("event_cursor_source" IN ('trusted_prefix', 'none'));

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_projection_availability_check"
	CHECK ("projection_availability" IN ('available', 'degraded', 'unavailable'));

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_projection_event_log_status_check"
	CHECK ("projection_event_log_status" IN ('empty', 'complete', 'invalid'));

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_projection_status_check"
	CHECK ("projection_status" IN ('empty', 'complete', 'incomplete', 'failed'));

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_projection_counts_check"
	CHECK (
		"projection_event_count" >= 0
		AND "projection_trusted_event_count" >= 0
		AND "projection_valid_prefix_length" >= 0
		AND "projection_last_trusted_sequence" >= 0
		AND ("projection_first_invalid_sequence" IS NULL OR "projection_first_invalid_sequence" > 0)
	);

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_final_status_check"
	CHECK ("final_status" IN ('not_final', 'final'));

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_winner_source_check"
	CHECK ("winner_source" IS NULL OR "winner_source" IN ('durable_projection', 'degraded', 'best_available_terminal_result'));

ALTER TABLE "game_watch_state_summaries"
	ADD CONSTRAINT "game_watch_state_summaries_rounds_played_check"
	CHECK ("rounds_played" IS NULL OR "rounds_played" >= 0);
