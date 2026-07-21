CREATE TABLE "game_transcript_states" (
	"game_id" text PRIMARY KEY NOT NULL,
	"capture_version" integer DEFAULT 1 NOT NULL,
	"owner_epoch" text,
	"durable_event_sequence" integer DEFAULT 0 NOT NULL,
	"durable_event_hash" text,
	"durable_sequence" integer DEFAULT 0 NOT NULL,
	"durable_count" integer DEFAULT 0 NOT NULL,
	"prefix_digest" text NOT NULL,
	"terminal_state" text DEFAULT 'unset' NOT NULL,
	"terminal_count" integer,
	"terminal_digest" text,
	"safe_degradation_code" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_transcript_states_capture_version_check" CHECK ("game_transcript_states"."capture_version" > 0),
	CONSTRAINT "game_transcript_states_durable_event_sequence_check" CHECK ("game_transcript_states"."durable_event_sequence" >= 0),
	CONSTRAINT "game_transcript_states_durable_sequence_check" CHECK ("game_transcript_states"."durable_sequence" >= 0),
	CONSTRAINT "game_transcript_states_durable_count_check" CHECK ("game_transcript_states"."durable_count" >= 0),
	CONSTRAINT "game_transcript_states_prefix_digest_check" CHECK ("game_transcript_states"."prefix_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "game_transcript_states_terminal_state_check" CHECK ("game_transcript_states"."terminal_state" IN ('unset', 'complete', 'partial', 'unavailable', 'degraded')),
	CONSTRAINT "game_transcript_states_terminal_count_check" CHECK ("game_transcript_states"."terminal_count" IS NULL OR "game_transcript_states"."terminal_count" >= 0),
	CONSTRAINT "game_transcript_states_terminal_digest_check" CHECK ("game_transcript_states"."terminal_digest" IS NULL OR "game_transcript_states"."terminal_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "game_transcript_states_durable_event_hash_check" CHECK ("game_transcript_states"."durable_event_hash" IS NULL OR "game_transcript_states"."durable_event_hash" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "game_completion_settlements" DROP CONSTRAINT "game_completion_settlements_payload_schema_version_check";--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "transcript_capture_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "formal_speech_capture_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "entry_sequence" integer;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "first_durable_event_sequence" integer;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "speaker_player_id" text;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "audience_player_ids" text[];--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "capture_version" integer;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "dialogue_kind" text;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "safe_context" jsonb;--> statement-breakpoint
ALTER TABLE "game_transcript_states" ADD CONSTRAINT "game_transcript_states_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_transcript_states" ADD CONSTRAINT "game_transcript_states_game_owner_fk" FOREIGN KEY ("game_id","owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_game_id_entry_sequence_unique" ON "transcripts" USING btree ("game_id","entry_sequence") WHERE "transcripts"."entry_sequence" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transcripts_game_id_entry_sequence_idx" ON "transcripts" USING btree ("game_id","entry_sequence") WHERE "transcripts"."entry_sequence" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transcripts_game_id_timestamp_id_idx" ON "transcripts" USING btree ("game_id","timestamp","id");--> statement-breakpoint
CREATE INDEX "transcripts_audience_player_ids_gin_idx" ON "transcripts" USING gin ("audience_player_ids");--> statement-breakpoint
CREATE INDEX "transcripts_speaker_player_id_idx" ON "transcripts" USING btree ("game_id","speaker_player_id");--> statement-breakpoint
ALTER TABLE "game_completion_settlements" ADD CONSTRAINT "game_completion_settlements_payload_schema_version_check" CHECK ("game_completion_settlements"."payload_schema_version" IN (1, 2));--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_entry_sequence_positive_check" CHECK ("transcripts"."entry_sequence" IS NULL OR "transcripts"."entry_sequence" > 0);--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_first_durable_event_sequence_positive_check" CHECK ("transcripts"."first_durable_event_sequence" IS NULL OR "transcripts"."first_durable_event_sequence" > 0);--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_capture_version_positive_check" CHECK ("transcripts"."capture_version" IS NULL OR "transcripts"."capture_version" > 0);--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_current_capture_dialogue_fields_check" CHECK (
      "transcripts"."capture_version" IS NULL
      OR "transcripts"."capture_version" < 1
      OR "transcripts"."scope" IN ('diary', 'thinking')
      OR (
        "transcripts"."entry_sequence" IS NOT NULL
        AND "transcripts"."audience_player_ids" IS NOT NULL
        AND "transcripts"."safe_context" IS NOT NULL
        AND (
          "transcripts"."scope" <> 'system'
          OR "transcripts"."dialogue_kind" IS NOT NULL
        )
      )
    );--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_non_dialogue_scope_fields_check" CHECK (
      "transcripts"."scope" NOT IN ('diary', 'thinking')
      OR (
        "transcripts"."entry_sequence" IS NULL
        AND "transcripts"."audience_player_ids" IS NULL
        AND "transcripts"."safe_context" IS NULL
        AND "transcripts"."dialogue_kind" IS NULL
      )
    );