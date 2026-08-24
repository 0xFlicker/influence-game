CREATE TABLE "provider_attempt_evidence_outbox" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"logical_call_id" text NOT NULL,
	"game_id" text NOT NULL,
	"owner_epoch" text NOT NULL,
	"body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"storage_key" text NOT NULL,
	"manifest_id" text NOT NULL,
	"manifest_metadata" jsonb NOT NULL,
	"reconciliation_attempt_count" integer DEFAULT 0 NOT NULL,
	"next_reconciliation_at" text DEFAULT now()::text NOT NULL,
	"claim_token" text,
	"claim_expires_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "provider_attempt_evidence_outbox_shape_check" CHECK (
      "provider_attempt_evidence_outbox"."byte_length" > 0
      AND "provider_attempt_evidence_outbox"."body_sha256" LIKE 'sha256:%'
      AND "provider_attempt_evidence_outbox"."reconciliation_attempt_count" >= 0
      AND (
        ("provider_attempt_evidence_outbox"."claim_token" IS NULL AND "provider_attempt_evidence_outbox"."claim_expires_at" IS NULL)
        OR ("provider_attempt_evidence_outbox"."claim_token" IS NOT NULL AND "provider_attempt_evidence_outbox"."claim_expires_at" IS NOT NULL)
      )
    )
);
--> statement-breakpoint
CREATE TABLE "provider_call_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"logical_call_id" text NOT NULL,
	"game_id" text NOT NULL,
	"owner_epoch" text NOT NULL,
	"attempt_ordinal" integer NOT NULL,
	"transport_attempt_id" text NOT NULL,
	"reservation_hash" text NOT NULL,
	"terminal_hash" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"request_shape" text NOT NULL,
	"provider_profile_id" text NOT NULL,
	"catalog_id" text,
	"model_name" text NOT NULL,
	"started_at" text NOT NULL,
	"indeterminate_at" text,
	"indeterminate_reason" text,
	"completed_at" text,
	"latency_ms" integer,
	"outcome_kind" text,
	"outcome_message" text,
	"retryable" boolean,
	"disposition" text,
	"provider_request_id" text,
	"accounting" jsonb,
	"evidence_state" text DEFAULT 'not_required' NOT NULL,
	"evidence_manifest_id" text,
	"evidence_error" text,
	"spend_projection_state" text DEFAULT 'pending' NOT NULL,
	"spend_projection_error" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "provider_call_attempts_ordinal_check" CHECK ("provider_call_attempts"."attempt_ordinal" > 0),
	CONSTRAINT "provider_call_attempts_status_check" CHECK ("provider_call_attempts"."status" IN ('reserved', 'indeterminate', 'terminal')),
	CONSTRAINT "provider_call_attempts_request_shape_check" CHECK ("provider_call_attempts"."request_shape" IN ('chat_completions', 'responses')),
	CONSTRAINT "provider_call_attempts_outcome_check" CHECK ("provider_call_attempts"."outcome_kind" IS NULL OR "provider_call_attempts"."outcome_kind" IN (
      'usable', 'refusal', 'rate_limit', 'service_error',
      'transport_timeout', 'transport_error', 'authentication',
      'configuration', 'request_error', 'cancellation', 'empty_output', 'malformed_output',
      'wrong_tool', 'undecodable_structured_output'
    )),
	CONSTRAINT "provider_call_attempts_disposition_check" CHECK ("provider_call_attempts"."disposition" IS NULL OR "provider_call_attempts"."disposition" IN ('accepted', 'retry_scheduled', 'exhausted')),
	CONSTRAINT "provider_call_attempts_evidence_state_check" CHECK ("provider_call_attempts"."evidence_state" IN ('pending', 'not_required', 'stored', 'aggregated', 'degraded')),
	CONSTRAINT "provider_call_attempts_spend_state_check" CHECK ("provider_call_attempts"."spend_projection_state" IN ('pending', 'projected', 'failed')),
	CONSTRAINT "provider_call_attempts_terminal_shape_check" CHECK (
      (
        "provider_call_attempts"."status" = 'reserved'
        AND "provider_call_attempts"."terminal_hash" IS NULL
        AND "provider_call_attempts"."indeterminate_at" IS NULL
        AND "provider_call_attempts"."indeterminate_reason" IS NULL
        AND "provider_call_attempts"."completed_at" IS NULL
        AND "provider_call_attempts"."outcome_kind" IS NULL
        AND "provider_call_attempts"."disposition" IS NULL
      ) OR (
        "provider_call_attempts"."status" = 'indeterminate'
        AND "provider_call_attempts"."terminal_hash" IS NULL
        AND "provider_call_attempts"."indeterminate_at" IS NOT NULL
        AND "provider_call_attempts"."indeterminate_reason" = 'owner_lost_before_terminal'
        AND "provider_call_attempts"."completed_at" IS NULL
        AND "provider_call_attempts"."outcome_kind" IS NULL
        AND "provider_call_attempts"."disposition" IS NULL
      ) OR (
        "provider_call_attempts"."status" = 'terminal'
        AND "provider_call_attempts"."terminal_hash" IS NOT NULL
        AND "provider_call_attempts"."completed_at" IS NOT NULL
        AND "provider_call_attempts"."outcome_kind" IS NOT NULL
        AND "provider_call_attempts"."disposition" IS NOT NULL
        AND "provider_call_attempts"."latency_ms" >= 0
      )
    )
);
--> statement-breakpoint
CREATE TABLE "provider_logical_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"phase" text,
	"round" integer,
	"logical_call_ordinal" integer NOT NULL,
	"next_attempt_ordinal" integer DEFAULT 1 NOT NULL,
	"rate_limit_count" integer DEFAULT 0 NOT NULL,
	"rate_limit_outcome" text,
	"rate_limit_terminal_reason" text,
	"diagnostics_degraded" boolean DEFAULT false NOT NULL,
	"evidence_failure_count" integer DEFAULT 0 NOT NULL,
	"accepted_attempt_id" text,
	"accepted_catalog_id" text,
	"accepted_value" jsonb,
	"accepted_value_sha256" text,
	"accepted_at" text,
	"canonical_event_sequence" integer,
	"canonical_committed_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "provider_logical_calls_actor_role_check" CHECK ("provider_logical_calls"."actor_role" IN ('player', 'juror', 'house', 'system', 'producer')),
	CONSTRAINT "provider_logical_calls_ordinal_check" CHECK ("provider_logical_calls"."logical_call_ordinal" > 0 AND "provider_logical_calls"."next_attempt_ordinal" > 0),
	CONSTRAINT "provider_logical_calls_round_check" CHECK ("provider_logical_calls"."round" IS NULL OR "provider_logical_calls"."round" >= 0),
	CONSTRAINT "provider_logical_calls_rate_limit_check" CHECK (
      "provider_logical_calls"."rate_limit_count" >= 0
      AND "provider_logical_calls"."evidence_failure_count" >= 0
      AND (
        ("provider_logical_calls"."rate_limit_count" = 0 AND "provider_logical_calls"."rate_limit_outcome" IS NULL AND "provider_logical_calls"."rate_limit_terminal_reason" IS NULL)
        OR ("provider_logical_calls"."rate_limit_count" > 0 AND "provider_logical_calls"."rate_limit_outcome" IN ('pending', 'recovered', 'exhausted'))
      )
      AND ("provider_logical_calls"."rate_limit_outcome" = 'exhausted' OR "provider_logical_calls"."rate_limit_terminal_reason" IS NULL)
    ),
	CONSTRAINT "provider_logical_calls_accepted_shape_check" CHECK (
      (
        "accepted_attempt_id" IS NULL
        AND "accepted_catalog_id" IS NULL
        AND "accepted_value" IS NULL
        AND "accepted_value_sha256" IS NULL
        AND "accepted_at" IS NULL
        AND "canonical_event_sequence" IS NULL
        AND "canonical_committed_at" IS NULL
      ) OR (
        "accepted_attempt_id" IS NOT NULL
        AND "accepted_catalog_id" IS NOT NULL
        AND "accepted_value" IS NOT NULL
        AND "accepted_value_sha256" LIKE 'sha256:%'
        AND "accepted_at" IS NOT NULL
        AND (
          ("canonical_event_sequence" IS NULL AND "canonical_committed_at" IS NULL)
          OR ("canonical_event_sequence" > 0 AND "canonical_committed_at" IS NOT NULL)
        )
      )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_logical_calls_id_game_unique" ON "provider_logical_calls" USING btree ("id","game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_call_attempts_id_game_unique" ON "provider_call_attempts" USING btree ("id","game_id");--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" ADD CONSTRAINT "provider_attempt_evidence_outbox_attempt_game_fk" FOREIGN KEY ("attempt_id","game_id") REFERENCES "public"."provider_call_attempts"("id","game_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" ADD CONSTRAINT "provider_attempt_evidence_outbox_logical_call_game_fk" FOREIGN KEY ("logical_call_id","game_id") REFERENCES "public"."provider_logical_calls"("id","game_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" ADD CONSTRAINT "provider_attempt_evidence_outbox_game_owner_fk" FOREIGN KEY ("game_id","owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_call_attempts" ADD CONSTRAINT "provider_call_attempts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_call_attempts" ADD CONSTRAINT "provider_call_attempts_evidence_manifest_id_game_evidence_manifests_id_fk" FOREIGN KEY ("evidence_manifest_id") REFERENCES "public"."game_evidence_manifests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_call_attempts" ADD CONSTRAINT "provider_call_attempts_logical_call_game_fk" FOREIGN KEY ("logical_call_id","game_id") REFERENCES "public"."provider_logical_calls"("id","game_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_call_attempts" ADD CONSTRAINT "provider_call_attempts_game_owner_fk" FOREIGN KEY ("game_id","owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD CONSTRAINT "provider_logical_calls_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_attempt_evidence_outbox_ready_idx" ON "provider_attempt_evidence_outbox" USING btree ("next_reconciliation_at","claim_expires_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_call_attempts_call_ordinal_unique" ON "provider_call_attempts" USING btree ("logical_call_id","attempt_ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_call_attempts_transport_id_unique" ON "provider_call_attempts" USING btree ("transport_attempt_id");--> statement-breakpoint
CREATE INDEX "provider_call_attempts_game_idx" ON "provider_call_attempts" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "provider_call_attempts_projection_idx" ON "provider_call_attempts" USING btree ("spend_projection_state","updated_at");--> statement-breakpoint
CREATE INDEX "provider_call_attempts_evidence_idx" ON "provider_call_attempts" USING btree ("evidence_state","updated_at");--> statement-breakpoint
CREATE INDEX "provider_logical_calls_game_idx" ON "provider_logical_calls" USING btree ("game_id","created_at");
