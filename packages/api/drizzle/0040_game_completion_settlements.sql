CREATE TABLE "game_completion_settlement_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"request_attempt_id" text,
	"game_id" text NOT NULL,
	"settlement_id" text,
	"source" text NOT NULL,
	"actor_user_id" text,
	"requested_reason" text,
	"outcome" text NOT NULL,
	"prior_state" text,
	"resulting_state" text,
	"result_hash" text,
	"safe_failure_code" text,
	"safe_metadata" jsonb,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_completion_settlement_attempts_source_check" CHECK ("game_completion_settlement_attempts"."source" IN ('runner', 'admin')),
	CONSTRAINT "game_completion_settlement_attempts_outcome_check" CHECK ("game_completion_settlement_attempts"."outcome" IN ('requested', 'succeeded', 'already_completed', 'repair_required', 'repair_blocked', 'invalid_state', 'failed', 'denied')),
	CONSTRAINT "game_completion_settlement_attempts_prior_state_check" CHECK ("game_completion_settlement_attempts"."prior_state" IS NULL OR "game_completion_settlement_attempts"."prior_state" IN ('pending', 'repair_required', 'completed')),
	CONSTRAINT "game_completion_settlement_attempts_resulting_state_check" CHECK ("game_completion_settlement_attempts"."resulting_state" IS NULL OR "game_completion_settlement_attempts"."resulting_state" IN ('pending', 'repair_required', 'completed')),
	CONSTRAINT "game_completion_settlement_attempts_result_hash_check" CHECK ("game_completion_settlement_attempts"."result_hash" IS NULL OR "game_completion_settlement_attempts"."result_hash" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "game_completion_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"owner_epoch" text NOT NULL,
	"final_event_sequence" integer NOT NULL,
	"final_event_hash" text NOT NULL,
	"payload_schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_safe_failure_code" text,
	"retry_ready_at" text,
	"captured_at" text DEFAULT now()::text NOT NULL,
	"last_attempted_at" text,
	"completed_at" text,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_completion_settlements_game_id_id_unique" UNIQUE("game_id","id"),
	CONSTRAINT "game_completion_settlements_state_check" CHECK ("game_completion_settlements"."state" IN ('pending', 'repair_required', 'completed')),
	CONSTRAINT "game_completion_settlements_event_sequence_check" CHECK ("game_completion_settlements"."final_event_sequence" > 0),
	CONSTRAINT "game_completion_settlements_payload_schema_version_check" CHECK ("game_completion_settlements"."payload_schema_version" = 1),
	CONSTRAINT "game_completion_settlements_attempt_count_check" CHECK ("game_completion_settlements"."attempt_count" >= 0),
	CONSTRAINT "game_completion_settlements_final_event_hash_check" CHECK ("game_completion_settlements"."final_event_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "game_completion_settlements_payload_hash_check" CHECK ("game_completion_settlements"."payload_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "game_completion_settlements_completed_at_check" CHECK (
    ("game_completion_settlements"."state" = 'completed' AND "game_completion_settlements"."completed_at" IS NOT NULL)
    OR ("game_completion_settlements"."state" <> 'completed' AND "game_completion_settlements"."completed_at" IS NULL)
  ),
	CONSTRAINT "game_completion_settlements_retry_ready_check" CHECK (
    "game_completion_settlements"."retry_ready_at" IS NULL OR "game_completion_settlements"."state" = 'pending'
  )
);
--> statement-breakpoint
ALTER TABLE "game_completion_settlement_attempts" ADD CONSTRAINT "game_completion_settlement_attempts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_completion_settlement_attempts" ADD CONSTRAINT "game_completion_settlement_attempts_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_completion_settlement_attempts" ADD CONSTRAINT "game_completion_settlement_attempts_request_attempt_fk" FOREIGN KEY ("request_attempt_id") REFERENCES "public"."game_completion_settlement_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_completion_settlement_attempts" ADD CONSTRAINT "game_completion_settlement_attempts_game_settlement_fk" FOREIGN KEY ("game_id","settlement_id") REFERENCES "public"."game_completion_settlements"("game_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_completion_settlements" ADD CONSTRAINT "game_completion_settlements_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_completion_settlements" ADD CONSTRAINT "game_completion_settlements_game_owner_fk" FOREIGN KEY ("game_id","owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_completion_settlements" ADD CONSTRAINT "game_completion_settlements_event_boundary_fk" FOREIGN KEY ("game_id","final_event_sequence") REFERENCES "public"."game_events"("game_id","sequence") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_completion_settlement_attempts_game_id_idx" ON "game_completion_settlement_attempts" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "game_completion_settlement_attempts_settlement_id_idx" ON "game_completion_settlement_attempts" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_completion_settlement_attempts_request_attempt_id_unique" ON "game_completion_settlement_attempts" USING btree ("request_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_completion_settlements_game_id_unique" ON "game_completion_settlements" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_completion_settlements_state_idx" ON "game_completion_settlements" USING btree ("state","retry_ready_at");--> statement-breakpoint
CREATE FUNCTION "prevent_game_completion_settlement_envelope_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF ROW(
		OLD."id",
		OLD."game_id",
		OLD."owner_epoch",
		OLD."final_event_sequence",
		OLD."final_event_hash",
		OLD."payload_schema_version",
		OLD."payload",
		OLD."payload_hash",
		OLD."captured_at"
	) IS DISTINCT FROM ROW(
		NEW."id",
		NEW."game_id",
		NEW."owner_epoch",
		NEW."final_event_sequence",
		NEW."final_event_hash",
		NEW."payload_schema_version",
		NEW."payload",
		NEW."payload_hash",
		NEW."captured_at"
	) THEN
		RAISE EXCEPTION 'completion settlement envelope fields are immutable'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "game_completion_settlements_envelope_immutable"
BEFORE UPDATE ON "game_completion_settlements"
FOR EACH ROW EXECUTE FUNCTION "prevent_game_completion_settlement_envelope_update"();
