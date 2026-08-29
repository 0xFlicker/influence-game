CREATE TABLE "game_execution_states" (
	"game_id" text PRIMARY KEY NOT NULL,
	"contract_version" integer DEFAULT 1 NOT NULL,
	"owner_epoch" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"committed_turn_sequence" integer DEFAULT 0 NOT NULL,
	"event_head_sequence" integer DEFAULT 0 NOT NULL,
	"event_head_hash" text,
	"dialogue_head_sequence" integer DEFAULT 0 NOT NULL,
	"publication_head_sequence" integer DEFAULT 0 NOT NULL,
	"xstate_snapshot" jsonb NOT NULL,
	"execution_cursor" jsonb NOT NULL,
	"player_continuity_capsules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"house_narrative_continuity" jsonb,
	"retry_state" jsonb,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_execution_states_contract_version_check" CHECK ("game_execution_states"."contract_version" = 1),
	CONSTRAINT "game_execution_states_status_check" CHECK ("game_execution_states"."status" IN ('ready', 'waiting_retry', 'terminal', 'repair_required')),
	CONSTRAINT "game_execution_states_heads_check" CHECK (
    "game_execution_states"."committed_turn_sequence" >= 0
    AND "game_execution_states"."event_head_sequence" >= 0
    AND "game_execution_states"."dialogue_head_sequence" >= 0
    AND "game_execution_states"."publication_head_sequence" >= 0
  ),
	CONSTRAINT "game_execution_states_event_hash_check" CHECK (
    ("game_execution_states"."event_head_sequence" = 0 AND "game_execution_states"."event_head_hash" IS NULL)
    OR (
      "game_execution_states"."event_head_sequence" > 0
      AND "game_execution_states"."event_head_hash" ~ '^sha256:[0-9a-f]{64}$'
    )
  ),
	CONSTRAINT "game_execution_states_retry_check" CHECK (
    ("game_execution_states"."status" = 'waiting_retry' AND "game_execution_states"."retry_state" IS NOT NULL)
    OR ("game_execution_states"."status" <> 'waiting_retry' AND "game_execution_states"."retry_state" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "game_execution_states" ADD CONSTRAINT "game_execution_states_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_execution_states" ADD CONSTRAINT "game_execution_states_game_owner_fk" FOREIGN KEY ("game_id","owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "game_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"contract_version" integer DEFAULT 1 NOT NULL,
	"turn_sequence" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"planned_owner_epoch" text NOT NULL,
	"committed_owner_epoch" text,
	"base_event_sequence" integer NOT NULL,
	"base_dialogue_sequence" integer NOT NULL,
	"base_publication_sequence" integer NOT NULL,
	"intent" jsonb NOT NULL,
	"intent_hash" text NOT NULL,
	"effect_hash" text,
	"commit_result" jsonb,
	"planned_at" text DEFAULT now()::text NOT NULL,
	"committed_at" text,
	CONSTRAINT "game_turns_game_id_id_unique" UNIQUE("game_id","id"),
	CONSTRAINT "game_turns_contract_version_check" CHECK ("game_turns"."contract_version" = 1),
	CONSTRAINT "game_turns_sequence_check" CHECK ("game_turns"."turn_sequence" > 0),
	CONSTRAINT "game_turns_base_heads_check" CHECK (
    "game_turns"."base_event_sequence" >= 0
    AND "game_turns"."base_dialogue_sequence" >= 0
    AND "game_turns"."base_publication_sequence" >= 0
  ),
	CONSTRAINT "game_turns_hashes_check" CHECK (
    "game_turns"."intent_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND ("game_turns"."effect_hash" IS NULL OR "game_turns"."effect_hash" ~ '^sha256:[0-9a-f]{64}$')
  ),
	CONSTRAINT "game_turns_commit_shape_check" CHECK (
    (
      "game_turns"."status" = 'planned'
      AND "game_turns"."committed_owner_epoch" IS NULL
      AND "game_turns"."effect_hash" IS NULL
      AND "game_turns"."commit_result" IS NULL
      AND "game_turns"."committed_at" IS NULL
    ) OR (
      "game_turns"."status" = 'committed'
      AND "game_turns"."committed_owner_epoch" IS NOT NULL
      AND "game_turns"."effect_hash" IS NOT NULL
      AND "game_turns"."commit_result" IS NOT NULL
      AND "game_turns"."committed_at" IS NOT NULL
    )
  )
);
--> statement-breakpoint
ALTER TABLE "game_turns" ADD CONSTRAINT "game_turns_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_turns" ADD CONSTRAINT "game_turns_planned_owner_fk" FOREIGN KEY ("game_id","planned_owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_turns" ADD CONSTRAINT "game_turns_committed_owner_fk" FOREIGN KEY ("game_id","committed_owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "game_turns_game_sequence_unique" ON "game_turns" USING btree ("game_id","turn_sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "game_turns_one_planned_per_game" ON "game_turns" USING btree ("game_id") WHERE "game_turns"."status" = 'planned';
--> statement-breakpoint
CREATE INDEX "game_turns_game_status_idx" ON "game_turns" USING btree ("game_id","status");
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "game_turn_id" text;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "game_turn_transcript_ordinal" integer;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_game_turn_fk" FOREIGN KEY ("game_id","game_turn_id") REFERENCES "public"."game_turns"("game_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_game_turn_shape_check" CHECK (
  ("transcripts"."game_turn_id" IS NULL AND "transcripts"."game_turn_transcript_ordinal" IS NULL)
  OR ("transcripts"."game_turn_id" IS NOT NULL AND "transcripts"."game_turn_transcript_ordinal" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_game_turn_ordinal_unique" ON "transcripts" USING btree ("game_id","game_turn_id","game_turn_transcript_ordinal") WHERE "transcripts"."game_turn_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "game_publications" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"publication_sequence" integer NOT NULL,
	"turn_id" text NOT NULL,
	"turn_sequence" integer NOT NULL,
	"turn_publication_ordinal" integer NOT NULL,
	"contract_version" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"available_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_publications_contract_version_check" CHECK ("game_publications"."contract_version" = 1),
	CONSTRAINT "game_publications_sequence_check" CHECK (
    "game_publications"."publication_sequence" > 0
    AND "game_publications"."turn_sequence" > 0
    AND "game_publications"."turn_publication_ordinal" > 0
  ),
	CONSTRAINT "game_publications_kind_check" CHECK ("game_publications"."kind" IN ('canonical_event', 'transcript_entry', 'completion'))
);
--> statement-breakpoint
ALTER TABLE "game_publications" ADD CONSTRAINT "game_publications_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_publications" ADD CONSTRAINT "game_publications_game_turn_fk" FOREIGN KEY ("game_id","turn_id") REFERENCES "public"."game_turns"("game_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "game_publications_game_sequence_unique" ON "game_publications" USING btree ("game_id","publication_sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "game_publications_turn_ordinal_unique" ON "game_publications" USING btree ("turn_id","turn_publication_ordinal");
--> statement-breakpoint
CREATE INDEX "game_publications_available_idx" ON "game_publications" USING btree ("game_id","available_at","publication_sequence");
--> statement-breakpoint
CREATE INDEX "game_publications_due_idx" ON "game_publications" USING btree ("available_at","game_id","publication_sequence");
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN "game_turn_id" text;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN "game_turn_subcall_slot" integer;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN "game_turn_committed_at" text;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD CONSTRAINT "provider_logical_calls_game_turn_fk" FOREIGN KEY ("game_id","game_turn_id") REFERENCES "public"."game_turns"("game_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD CONSTRAINT "provider_logical_calls_game_turn_shape_check" CHECK (
  (
    "provider_logical_calls"."game_turn_id" IS NULL
    AND "provider_logical_calls"."game_turn_subcall_slot" IS NULL
    AND "provider_logical_calls"."game_turn_committed_at" IS NULL
  ) OR (
    "provider_logical_calls"."game_turn_id" IS NOT NULL
    AND "provider_logical_calls"."game_turn_subcall_slot" > 0
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_logical_calls_turn_slot_unique" ON "provider_logical_calls" USING btree ("game_turn_id","game_turn_subcall_slot") WHERE "provider_logical_calls"."game_turn_id" IS NOT NULL;
