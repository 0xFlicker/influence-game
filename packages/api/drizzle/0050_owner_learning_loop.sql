CREATE TABLE "agent_learning_events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"review_id" text,
	"agent_profile_id" text,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_learning_events_kind_check" CHECK (
    "agent_learning_events"."kind" IN (
      'prompt_impression', 'prompt_dismissed', 'review_started',
      'analysis_track_selected', 'credit_consumed', 'stage_reached',
      'capacity_fallback_started', 'review_failed', 'review_retried',
      'review_declined', 'review_superseded', 'review_resolved',
      'recommendations_viewed', 'manual_editor_opened', 'proposal_applied',
      'mcp_offer_viewed', 'mcp_connected'
    )
  ),
	CONSTRAINT "agent_learning_events_payload_check" CHECK (jsonb_typeof("agent_learning_events"."payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "agent_learning_game_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"agent_profile_id" text NOT NULL,
	"analytical_revision_id" text NOT NULL,
	"game_id" text NOT NULL,
	"evidence_version" text NOT NULL,
	"eligibility_policy_version" text NOT NULL,
	"completion_at" text NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	"candidate_moments" jsonb NOT NULL,
	"source_capture_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_learning_moment_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"game_evidence_id" text NOT NULL,
	"agent_profile_id" text NOT NULL,
	"reviewed_player_id" text NOT NULL,
	"source_bundle_hash" text NOT NULL,
	"visibility_policy_version" text NOT NULL,
	"evidence_version" text NOT NULL,
	"window_version" text NOT NULL,
	"normalization_version" text NOT NULL,
	"source_refs" jsonb NOT NULL,
	"bundle_metadata" jsonb NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_learning_review_applications" (
	"review_id" text PRIMARY KEY NOT NULL,
	"proposal_fingerprint" text NOT NULL,
	"source_recommendation_ids" jsonb NOT NULL,
	"prior_revision_id" text NOT NULL,
	"resulting_revision_id" text NOT NULL,
	"prior_strategy_style" text NOT NULL,
	"resulting_strategy_style" text NOT NULL,
	"mutation_receipt" jsonb NOT NULL,
	"applied_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_learning_review_applications_strategy_check" CHECK (
    length("agent_learning_review_applications"."prior_strategy_style") <= 2000
    AND length("agent_learning_review_applications"."resulting_strategy_style") <= 2000
    AND "agent_learning_review_applications"."prior_strategy_style" <> "agent_learning_review_applications"."resulting_strategy_style"
  )
);
--> statement-breakpoint
CREATE TABLE "agent_learning_review_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"stage" text NOT NULL,
	"input_policy_hash" text NOT NULL,
	"final_provider_request_id" text,
	"requested_tier" text DEFAULT 'flex' NOT NULL,
	"effective_tier" text,
	"requested_reasoning_effort" text DEFAULT 'low' NOT NULL,
	"token_receipt" jsonb,
	"transport_receipts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flex_429_count" integer DEFAULT 0 NOT NULL,
	"fallback_started_at" text,
	"capacity_path" text,
	"latency_ms" integer,
	"safe_failure_code" text,
	"cost_source" text DEFAULT 'unavailable' NOT NULL,
	"actual_cost_microusd" bigint,
	"estimated_cost_microusd" bigint,
	"pricing_source_id" text,
	"rate_card_version" text,
	"priced_at" text,
	"reserved_at" text DEFAULT now()::text NOT NULL,
	"dispatched_at" text,
	"completed_at" text,
	CONSTRAINT "agent_learning_review_calls_ordinal_check" CHECK ("agent_learning_review_calls"."ordinal" BETWEEN 1 AND 4),
	CONSTRAINT "agent_learning_review_calls_state_check" CHECK (
    "agent_learning_review_calls"."state" IN ('reserved', 'dispatched', 'succeeded', 'failed', 'ambiguous')
  ),
	CONSTRAINT "agent_learning_review_calls_tier_check" CHECK (
    "agent_learning_review_calls"."requested_tier" = 'flex'
    AND ("agent_learning_review_calls"."effective_tier" IS NULL OR "agent_learning_review_calls"."effective_tier" IN ('flex', 'auto', 'default'))
  ),
	CONSTRAINT "agent_learning_review_calls_reasoning_check" CHECK ("agent_learning_review_calls"."requested_reasoning_effort" = 'low'),
	CONSTRAINT "agent_learning_review_calls_transport_check" CHECK (
    jsonb_typeof("agent_learning_review_calls"."transport_receipts") = 'array'
    AND jsonb_array_length("agent_learning_review_calls"."transport_receipts") <= 4
    AND "agent_learning_review_calls"."flex_429_count" BETWEEN 0 AND 3
  ),
	CONSTRAINT "agent_learning_review_calls_capacity_path_check" CHECK (
    "agent_learning_review_calls"."capacity_path" IS NULL OR "agent_learning_review_calls"."capacity_path" IN ('flex', 'standard_fallback')
  ),
	CONSTRAINT "agent_learning_review_calls_nonnegative_check" CHECK (
    ("agent_learning_review_calls"."latency_ms" IS NULL OR "agent_learning_review_calls"."latency_ms" >= 0)
    AND ("agent_learning_review_calls"."actual_cost_microusd" IS NULL OR "agent_learning_review_calls"."actual_cost_microusd" >= 0)
    AND ("agent_learning_review_calls"."estimated_cost_microusd" IS NULL OR "agent_learning_review_calls"."estimated_cost_microusd" >= 0)
  ),
	CONSTRAINT "agent_learning_review_calls_cost_check" CHECK (
    ("agent_learning_review_calls"."cost_source" = 'actual' AND "agent_learning_review_calls"."actual_cost_microusd" IS NOT NULL AND "agent_learning_review_calls"."estimated_cost_microusd" IS NULL)
    OR ("agent_learning_review_calls"."cost_source" = 'estimated' AND "agent_learning_review_calls"."actual_cost_microusd" IS NULL AND "agent_learning_review_calls"."estimated_cost_microusd" IS NOT NULL)
    OR ("agent_learning_review_calls"."cost_source" = 'unavailable' AND "agent_learning_review_calls"."actual_cost_microusd" IS NULL AND "agent_learning_review_calls"."estimated_cost_microusd" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "agent_learning_review_entitlements" (
	"owner_user_id" text PRIMARY KEY NOT NULL,
	"consumed_completion_at" text,
	"consumed_game_id" text,
	"last_paid_review_started_at" text,
	"last_surfaced_threshold" integer,
	"dismissed_completion_at" text,
	"dismissed_game_id" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_learning_review_entitlements_watermark_check" CHECK (
    ("agent_learning_review_entitlements"."consumed_completion_at" IS NULL AND "agent_learning_review_entitlements"."consumed_game_id" IS NULL)
    OR ("agent_learning_review_entitlements"."consumed_completion_at" IS NOT NULL AND "agent_learning_review_entitlements"."consumed_game_id" IS NOT NULL)
  ),
	CONSTRAINT "agent_learning_review_entitlements_dismissal_check" CHECK (
    ("agent_learning_review_entitlements"."dismissed_completion_at" IS NULL AND "agent_learning_review_entitlements"."dismissed_game_id" IS NULL)
    OR ("agent_learning_review_entitlements"."dismissed_completion_at" IS NOT NULL AND "agent_learning_review_entitlements"."dismissed_game_id" IS NOT NULL)
  ),
	CONSTRAINT "agent_learning_review_entitlements_threshold_check" CHECK (
    "agent_learning_review_entitlements"."last_surfaced_threshold" IS NULL OR "agent_learning_review_entitlements"."last_surfaced_threshold" IN (1, 3)
  )
);
--> statement-breakpoint
CREATE TABLE "agent_learning_review_games" (
	"review_id" text NOT NULL,
	"game_evidence_id" text NOT NULL,
	"game_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_learning_review_games_review_id_position_pk" PRIMARY KEY("review_id","position"),
	CONSTRAINT "agent_learning_review_games_position_check" CHECK ("agent_learning_review_games"."position" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "agent_learning_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"agent_profile_id" text NOT NULL,
	"reviewed_revision_id" text NOT NULL,
	"selected_game_fingerprint" text NOT NULL,
	"start_idempotency_key" text NOT NULL,
	"eligibility_policy_version" text NOT NULL,
	"evidence_version" text NOT NULL,
	"reviewer_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"provider_policy_version" text NOT NULL,
	"selected_model" text NOT NULL,
	"analysis_track" text NOT NULL,
	"analysis_status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'evidence_ready' NOT NULL,
	"resolution" text,
	"resolved_at" text,
	"logical_call_count" integer DEFAULT 0 NOT NULL,
	"dive_count" integer DEFAULT 0 NOT NULL,
	"lease_token_hash" text,
	"lease_expires_at" text,
	"claimed_at" text,
	"capacity_substatus" text,
	"safe_failure_code" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"checkpoint" jsonb,
	"checkpoint_hash" text,
	"result" jsonb,
	"proposal_fingerprint" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"started_at" text,
	"completed_at" text,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_learning_reviews_id_proposal_unique" UNIQUE("id","proposal_fingerprint"),
	CONSTRAINT "agent_learning_reviews_analysis_track_check" CHECK (
    "agent_learning_reviews"."analysis_track" IN ('evidence_rich', 'strategy_health_check')
  ),
	CONSTRAINT "agent_learning_reviews_analysis_status_check" CHECK (
    "agent_learning_reviews"."analysis_status" IN ('queued', 'running', 'ready', 'no_change', 'failed')
  ),
	CONSTRAINT "agent_learning_reviews_stage_check" CHECK (
    "agent_learning_reviews"."stage" IN ('evidence_ready', 'scanning_narratives', 'investigating_moments', 'drafting_recommendations', 'complete')
  ),
	CONSTRAINT "agent_learning_reviews_resolution_check" CHECK (
    "agent_learning_reviews"."resolution" IS NULL OR "agent_learning_reviews"."resolution" IN ('applied', 'manual_update', 'declined', 'no_change', 'failed', 'superseded')
  ),
	CONSTRAINT "agent_learning_reviews_resolution_timestamp_check" CHECK (
    ("agent_learning_reviews"."resolution" IS NULL AND "agent_learning_reviews"."resolved_at" IS NULL)
    OR ("agent_learning_reviews"."resolution" IS NOT NULL AND "agent_learning_reviews"."resolved_at" IS NOT NULL)
  ),
	CONSTRAINT "agent_learning_reviews_budget_check" CHECK (
    "agent_learning_reviews"."logical_call_count" BETWEEN 0 AND 4 AND "agent_learning_reviews"."dive_count" BETWEEN 0 AND 3
  ),
	CONSTRAINT "agent_learning_reviews_capacity_check" CHECK (
    "agent_learning_reviews"."capacity_substatus" IS NULL OR "agent_learning_reviews"."capacity_substatus" IN ('waiting_for_capacity', 'using_standard_capacity')
  ),
	CONSTRAINT "agent_learning_reviews_failure_check" CHECK (
    "agent_learning_reviews"."safe_failure_code" IS NULL OR "agent_learning_reviews"."safe_failure_code" IN (
      'provider_capacity_exhausted', 'provider_timeout', 'provider_error',
      'invalid_structured_output', 'tier_mismatch',
      'output_budget_exhausted', 'logical_call_budget_exhausted',
      'evidence_unavailable', 'worker_interrupted'
    )
  ),
	CONSTRAINT "agent_learning_reviews_result_state_check" CHECK (
    ("agent_learning_reviews"."analysis_status" IN ('ready', 'no_change') AND "agent_learning_reviews"."result" IS NOT NULL AND "agent_learning_reviews"."stage" = 'complete')
    OR ("agent_learning_reviews"."analysis_status" NOT IN ('ready', 'no_change') AND "agent_learning_reviews"."result" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "agent_learning_events" ADD CONSTRAINT "agent_learning_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_events" ADD CONSTRAINT "agent_learning_events_review_id_agent_learning_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_learning_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_events" ADD CONSTRAINT "agent_learning_events_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" ADD CONSTRAINT "agent_learning_game_evidence_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" ADD CONSTRAINT "agent_learning_game_evidence_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" ADD CONSTRAINT "agent_learning_game_evidence_analytical_revision_id_agent_revisions_id_fk" FOREIGN KEY ("analytical_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" ADD CONSTRAINT "agent_learning_game_evidence_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_moment_evidence" ADD CONSTRAINT "agent_learning_moment_evidence_game_evidence_id_agent_learning_game_evidence_id_fk" FOREIGN KEY ("game_evidence_id") REFERENCES "public"."agent_learning_game_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_moment_evidence" ADD CONSTRAINT "agent_learning_moment_evidence_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_moment_evidence" ADD CONSTRAINT "agent_learning_moment_evidence_reviewed_player_id_game_players_id_fk" FOREIGN KEY ("reviewed_player_id") REFERENCES "public"."game_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_applications" ADD CONSTRAINT "agent_learning_review_applications_review_id_agent_learning_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_learning_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_applications" ADD CONSTRAINT "agent_learning_review_applications_prior_revision_id_agent_revisions_id_fk" FOREIGN KEY ("prior_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_applications" ADD CONSTRAINT "agent_learning_review_applications_resulting_revision_id_agent_revisions_id_fk" FOREIGN KEY ("resulting_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_applications" ADD CONSTRAINT "agent_learning_review_applications_proposal_fk" FOREIGN KEY ("review_id","proposal_fingerprint") REFERENCES "public"."agent_learning_reviews"("id","proposal_fingerprint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "agent_learning_review_calls_review_id_agent_learning_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_learning_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_entitlements" ADD CONSTRAINT "agent_learning_review_entitlements_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_entitlements" ADD CONSTRAINT "agent_learning_review_entitlements_consumed_game_id_games_id_fk" FOREIGN KEY ("consumed_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_entitlements" ADD CONSTRAINT "agent_learning_review_entitlements_dismissed_game_id_games_id_fk" FOREIGN KEY ("dismissed_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_games" ADD CONSTRAINT "agent_learning_review_games_review_id_agent_learning_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_learning_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_games" ADD CONSTRAINT "agent_learning_review_games_game_evidence_id_agent_learning_game_evidence_id_fk" FOREIGN KEY ("game_evidence_id") REFERENCES "public"."agent_learning_game_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_games" ADD CONSTRAINT "agent_learning_review_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "agent_learning_reviews_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "agent_learning_reviews_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "agent_learning_reviews_reviewed_revision_id_agent_revisions_id_fk" FOREIGN KEY ("reviewed_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_learning_events_owner_time_idx" ON "agent_learning_events" USING btree ("owner_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_learning_events_review_time_idx" ON "agent_learning_events" USING btree ("review_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_game_evidence_identity_unique" ON "agent_learning_game_evidence" USING btree ("owner_user_id","agent_profile_id","analytical_revision_id","game_id","evidence_version");--> statement-breakpoint
CREATE INDEX "agent_learning_game_evidence_owner_profile_idx" ON "agent_learning_game_evidence" USING btree ("owner_user_id","agent_profile_id","completion_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_moment_evidence_cache_unique" ON "agent_learning_moment_evidence" USING btree ("source_bundle_hash","agent_profile_id","reviewed_player_id","visibility_policy_version","evidence_version","window_version","normalization_version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_review_calls_ordinal_unique" ON "agent_learning_review_calls" USING btree ("review_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_review_games_review_game_unique" ON "agent_learning_review_games" USING btree ("review_id","game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_reviews_owner_idempotency_unique" ON "agent_learning_reviews" USING btree ("owner_user_id","start_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_reviews_owner_open_unique" ON "agent_learning_reviews" USING btree ("owner_user_id") WHERE "agent_learning_reviews"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "agent_learning_reviews_worker_claim_idx" ON "agent_learning_reviews" USING btree ("analysis_status","lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "agent_learning_reviews_admin_chronology_idx" ON "agent_learning_reviews" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "agent_learning_reviews_revision_resolution_idx" ON "agent_learning_reviews" USING btree ("agent_profile_id","reviewed_revision_id","resolution");
