CREATE TABLE "agent_learning_review_failure_diagnostics" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"call_id" text,
	"call_ordinal" integer,
	"attempt_ordinal" integer,
	"phase" text,
	"safe_failure_code" text NOT NULL,
	"error_class" text NOT NULL,
	"error_code" text,
	"sanitized_message" text NOT NULL,
	"first_application_stack_frame" text,
	"fingerprint" text NOT NULL,
	"provider_request_id" text,
	"provider_response_id" text,
	"evidence_manifest_id" text NOT NULL,
	"occurred_at" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_learning_review_failure_diagnostics_phase_check" CHECK (
    "agent_learning_review_failure_diagnostics"."phase" IS NULL OR "agent_learning_review_failure_diagnostics"."phase" IN (
      'selection', 'evidence_projection', 'materialization', 'call_reservation',
      'provider_invocation', 'output_validation', 'checkpoint_persistence', 'finalization'
    )
  ),
	CONSTRAINT "agent_learning_review_failure_diagnostics_coordinates_check" CHECK (
    ("agent_learning_review_failure_diagnostics"."call_id" IS NULL AND "agent_learning_review_failure_diagnostics"."call_ordinal" IS NULL AND "agent_learning_review_failure_diagnostics"."attempt_ordinal" IS NULL)
    OR (
      "agent_learning_review_failure_diagnostics"."call_id" IS NOT NULL
      AND "agent_learning_review_failure_diagnostics"."call_ordinal" BETWEEN 1 AND 4
      AND "agent_learning_review_failure_diagnostics"."attempt_ordinal" BETWEEN 1 AND 2
    )
  ),
	CONSTRAINT "agent_learning_review_failure_diagnostics_shape_check" CHECK (
    char_length("agent_learning_review_failure_diagnostics"."sanitized_message") BETWEEN 1 AND 2000
    AND ("agent_learning_review_failure_diagnostics"."first_application_stack_frame" IS NULL OR char_length("agent_learning_review_failure_diagnostics"."first_application_stack_frame") <= 1000)
    AND "agent_learning_review_failure_diagnostics"."fingerprint" LIKE 'sha256:%'
  )
);
--> statement-breakpoint
CREATE TABLE "agent_learning_review_failure_evidence_outbox" (
	"diagnostic_id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"manifest_id" text NOT NULL,
	"body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"storage_key" text NOT NULL,
	"manifest_metadata" jsonb NOT NULL,
	"reconciliation_attempt_count" integer DEFAULT 0 NOT NULL,
	"next_reconciliation_at" text DEFAULT now()::text NOT NULL,
	"claim_token" text,
	"claim_expires_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_learning_review_failure_evidence_outbox_shape_check" CHECK (
    "agent_learning_review_failure_evidence_outbox"."byte_length" > 0
    AND "agent_learning_review_failure_evidence_outbox"."body_sha256" LIKE 'sha256:%'
    AND "agent_learning_review_failure_evidence_outbox"."reconciliation_attempt_count" >= 0
    AND (
      ("agent_learning_review_failure_evidence_outbox"."claim_token" IS NULL AND "agent_learning_review_failure_evidence_outbox"."claim_expires_at" IS NULL)
      OR ("agent_learning_review_failure_evidence_outbox"."claim_token" IS NOT NULL AND "agent_learning_review_failure_evidence_outbox"."claim_expires_at" IS NOT NULL)
    )
  )
);
--> statement-breakpoint
CREATE TABLE "agent_learning_review_failure_manifest_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"manifest_id" text NOT NULL,
	"review_id" text NOT NULL,
	"accessor_user_id" text,
	"accessor_role" text NOT NULL,
	"purpose" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"offset_bytes" integer,
	"max_bytes" integer,
	"read_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_learning_review_failure_manifest_reads_outcome_check" CHECK (
    "agent_learning_review_failure_manifest_reads"."outcome" IN ('allowed', 'denied', 'unavailable', 'integrity_mismatch', 'storage_error')
  ),
	CONSTRAINT "agent_learning_review_failure_manifest_reads_range_check" CHECK (
    ("agent_learning_review_failure_manifest_reads"."offset_bytes" IS NULL OR "agent_learning_review_failure_manifest_reads"."offset_bytes" >= 0)
    AND ("agent_learning_review_failure_manifest_reads"."max_bytes" IS NULL OR "agent_learning_review_failure_manifest_reads"."max_bytes" > 0)
  )
);
--> statement-breakpoint
CREATE TABLE "agent_learning_review_failure_manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"diagnostic_id" text NOT NULL,
	"review_id" text NOT NULL,
	"state" text NOT NULL,
	"retention_class" text DEFAULT 'audit' NOT NULL,
	"access_scope" text DEFAULT 'admin_developer' NOT NULL,
	"content_type" text,
	"byte_length" integer,
	"body_sha256" text,
	"storage_provider" text,
	"storage_bucket" text,
	"storage_key" text,
	"source_pointers" jsonb NOT NULL,
	"metadata" jsonb NOT NULL,
	"last_storage_error" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"stored_at" text,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_learning_review_failure_manifests_diagnostic_id_unique" UNIQUE("diagnostic_id"),
	CONSTRAINT "agent_learning_review_failure_manifests_state_check" CHECK (
    "agent_learning_review_failure_manifests"."state" IN ('pending', 'stored', 'degraded', 'legacy_unavailable')
  ),
	CONSTRAINT "agent_learning_review_failure_manifests_policy_check" CHECK (
    "agent_learning_review_failure_manifests"."retention_class" = 'audit' AND "agent_learning_review_failure_manifests"."access_scope" = 'admin_developer'
  ),
	CONSTRAINT "agent_learning_review_failure_manifests_shape_check" CHECK (
    (
      "agent_learning_review_failure_manifests"."state" = 'legacy_unavailable'
      AND "agent_learning_review_failure_manifests"."content_type" IS NULL
      AND "agent_learning_review_failure_manifests"."byte_length" IS NULL
      AND "agent_learning_review_failure_manifests"."body_sha256" IS NULL
      AND "agent_learning_review_failure_manifests"."storage_provider" IS NULL
      AND "agent_learning_review_failure_manifests"."storage_bucket" IS NULL
      AND "agent_learning_review_failure_manifests"."storage_key" IS NULL
      AND "agent_learning_review_failure_manifests"."stored_at" IS NULL
    ) OR (
      "agent_learning_review_failure_manifests"."state" IN ('pending', 'degraded')
      AND "agent_learning_review_failure_manifests"."content_type" = 'application/json'
      AND "agent_learning_review_failure_manifests"."byte_length" > 0
      AND "agent_learning_review_failure_manifests"."body_sha256" LIKE 'sha256:%'
      AND "agent_learning_review_failure_manifests"."storage_provider" IS NULL
      AND "agent_learning_review_failure_manifests"."storage_bucket" IS NULL
      AND "agent_learning_review_failure_manifests"."storage_key" IS NULL
      AND "agent_learning_review_failure_manifests"."stored_at" IS NULL
    ) OR (
      "agent_learning_review_failure_manifests"."state" = 'stored'
      AND "agent_learning_review_failure_manifests"."content_type" = 'application/json'
      AND "agent_learning_review_failure_manifests"."byte_length" > 0
      AND "agent_learning_review_failure_manifests"."body_sha256" LIKE 'sha256:%'
      AND "agent_learning_review_failure_manifests"."storage_provider" IS NOT NULL
      AND "agent_learning_review_failure_manifests"."storage_bucket" IS NOT NULL
      AND "agent_learning_review_failure_manifests"."storage_key" IS NOT NULL
      AND "agent_learning_review_failure_manifests"."stored_at" IS NOT NULL
    )
  )
);
--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" DROP CONSTRAINT "agent_learning_reviews_failure_check";--> statement-breakpoint
DROP INDEX "agent_learning_review_calls_ordinal_unique";--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "attempt_ordinal" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "retry_of_attempt_id" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "provider_response_id" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "provider_response_observed_at" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "provider_response_sha256" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "evidence_state" text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "failure_diagnostic_id" text;--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD COLUMN "execution_phase" text;--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD COLUMN "owner_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD COLUMN "retry_target_attempt_id" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_diagnostics" ADD CONSTRAINT "agent_learning_review_failure_diagnostics_review_id_agent_learning_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_learning_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_diagnostics" ADD CONSTRAINT "agent_learning_review_failure_diagnostics_call_id_agent_learning_review_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."agent_learning_review_calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_evidence_outbox" ADD CONSTRAINT "agent_learning_review_failure_evidence_outbox_diagnostic_id_agent_learning_review_failure_diagnostics_id_fk" FOREIGN KEY ("diagnostic_id") REFERENCES "public"."agent_learning_review_failure_diagnostics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_evidence_outbox" ADD CONSTRAINT "agent_learning_review_failure_evidence_outbox_review_id_agent_learning_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_learning_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_evidence_outbox" ADD CONSTRAINT "agent_learning_review_failure_evidence_outbox_manifest_id_agent_learning_review_failure_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."agent_learning_review_failure_manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_manifest_reads" ADD CONSTRAINT "agent_learning_review_failure_manifest_reads_manifest_id_agent_learning_review_failure_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."agent_learning_review_failure_manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_manifest_reads" ADD CONSTRAINT "agent_learning_review_failure_manifest_reads_review_id_agent_learning_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_learning_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_manifest_reads" ADD CONSTRAINT "agent_learning_review_failure_manifest_reads_accessor_user_id_users_id_fk" FOREIGN KEY ("accessor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_manifests" ADD CONSTRAINT "agent_learning_review_failure_manifests_diagnostic_id_agent_learning_review_failure_diagnostics_id_fk" FOREIGN KEY ("diagnostic_id") REFERENCES "public"."agent_learning_review_failure_diagnostics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_manifests" ADD CONSTRAINT "agent_learning_review_failure_manifests_review_id_agent_learning_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_learning_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_review_failure_diagnostics_manifest_unique" ON "agent_learning_review_failure_diagnostics" USING btree ("evidence_manifest_id");--> statement-breakpoint
CREATE INDEX "agent_learning_review_failure_diagnostics_review_idx" ON "agent_learning_review_failure_diagnostics" USING btree ("review_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_learning_review_failure_diagnostics_fingerprint_idx" ON "agent_learning_review_failure_diagnostics" USING btree ("fingerprint","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_review_failure_evidence_outbox_manifest_unique" ON "agent_learning_review_failure_evidence_outbox" USING btree ("manifest_id");--> statement-breakpoint
CREATE INDEX "agent_learning_review_failure_evidence_outbox_ready_idx" ON "agent_learning_review_failure_evidence_outbox" USING btree ("next_reconciliation_at","claim_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "agent_learning_review_failure_manifest_reads_manifest_idx" ON "agent_learning_review_failure_manifest_reads" USING btree ("manifest_id","read_at");--> statement-breakpoint
CREATE INDEX "agent_learning_review_failure_manifest_reads_accessor_idx" ON "agent_learning_review_failure_manifest_reads" USING btree ("accessor_user_id","read_at");--> statement-breakpoint
CREATE INDEX "agent_learning_review_failure_manifests_review_idx" ON "agent_learning_review_failure_manifests" USING btree ("review_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_learning_review_failure_manifests_state_idx" ON "agent_learning_review_failure_manifests" USING btree ("state","updated_at");--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "agent_learning_review_calls_retry_of_attempt_id_agent_learning_review_calls_id_fk" FOREIGN KEY ("retry_of_attempt_id") REFERENCES "public"."agent_learning_review_calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "agent_learning_review_calls_failure_diagnostic_id_agent_learning_review_failure_diagnostics_id_fk" FOREIGN KEY ("failure_diagnostic_id") REFERENCES "public"."agent_learning_review_failure_diagnostics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "agent_learning_reviews_retry_target_attempt_id_agent_learning_review_calls_id_fk" FOREIGN KEY ("retry_target_attempt_id") REFERENCES "public"."agent_learning_review_calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_review_calls_ordinal_unique" ON "agent_learning_review_calls" USING btree ("review_id","ordinal","attempt_ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_review_calls_succeeded_unique" ON "agent_learning_review_calls" USING btree ("review_id","ordinal") WHERE "agent_learning_review_calls"."state" = 'succeeded';--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "agent_learning_review_calls_attempt_ordinal_check" CHECK ("agent_learning_review_calls"."attempt_ordinal" BETWEEN 1 AND 2);--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "agent_learning_review_calls_response_check" CHECK (
    (
      "agent_learning_review_calls"."provider_response_observed_at" IS NULL
      AND "agent_learning_review_calls"."provider_response_sha256" IS NULL
      AND "agent_learning_review_calls"."provider_response_id" IS NULL
    ) OR (
      "agent_learning_review_calls"."provider_response_observed_at" IS NOT NULL
      AND "agent_learning_review_calls"."provider_response_sha256" LIKE 'sha256:%'
    )
  );--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "agent_learning_review_calls_evidence_state_check" CHECK (
    "agent_learning_review_calls"."evidence_state" IN ('not_required', 'pending', 'stored', 'degraded', 'legacy_unavailable')
  );--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "agent_learning_reviews_execution_phase_check" CHECK (
    "agent_learning_reviews"."execution_phase" IS NULL OR "agent_learning_reviews"."execution_phase" IN (
      'selection', 'evidence_projection', 'materialization', 'call_reservation',
      'provider_invocation', 'output_validation', 'checkpoint_persistence', 'finalization'
    )
  );--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "agent_learning_reviews_owner_retry_check" CHECK (
    "agent_learning_reviews"."owner_retry_count" BETWEEN 0 AND 1
  );--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "agent_learning_reviews_failure_check" CHECK (
    "agent_learning_reviews"."safe_failure_code" IS NULL OR "agent_learning_reviews"."safe_failure_code" IN (
      'provider_capacity_exhausted', 'provider_timeout', 'provider_error',
      'invalid_structured_output', 'tier_mismatch',
      'output_budget_exhausted', 'logical_call_budget_exhausted',
      'evidence_unavailable', 'worker_interrupted', 'internal_error'
    )
  );--> statement-breakpoint
WITH legacy_failures AS (
  SELECT
    review.id AS review_id,
    failed_call.id AS call_id,
    failed_call.ordinal AS call_ordinal,
    failed_call.attempt_ordinal,
    COALESCE(review.safe_failure_code, 'internal_error') AS safe_failure_code,
    failed_call.final_provider_request_id AS provider_request_id,
    COALESCE(failed_call.completed_at, review.completed_at, review.updated_at, review.created_at) AS occurred_at,
    'legacy-owner-learning:' || encode(sha256(convert_to(
      review.id || ':' || COALESCE(failed_call.id, 'no-call') || ':legacy-uncaptured',
      'UTF8'
    )), 'hex') AS diagnostic_id
  FROM agent_learning_reviews review
  LEFT JOIN LATERAL (
    SELECT call.*
    FROM agent_learning_review_calls call
    WHERE call.review_id = review.id
      AND call.state IN ('failed', 'ambiguous')
    ORDER BY call.ordinal DESC, call.attempt_ordinal DESC, call.reserved_at DESC
    LIMIT 1
  ) failed_call ON true
  WHERE review.analysis_status = 'failed'
    AND NOT EXISTS (
      SELECT 1
      FROM agent_learning_review_failure_diagnostics diagnostic
      WHERE diagnostic.review_id = review.id
    )
)
INSERT INTO agent_learning_review_failure_diagnostics (
  id, review_id, call_id, call_ordinal, attempt_ordinal, phase,
  safe_failure_code, error_class, error_code, sanitized_message,
  fingerprint, provider_request_id, evidence_manifest_id, occurred_at
)
SELECT
  diagnostic_id,
  review_id,
  call_id,
  call_ordinal,
  attempt_ordinal,
  NULL,
  safe_failure_code,
  'LegacyUncapturedFailure',
  'legacy_uncaptured',
  'Exact failure evidence and execution phase were not captured by the legacy review worker.',
  'sha256:' || encode(sha256(convert_to(
    review_id || ':' || safe_failure_code || ':legacy-uncaptured',
    'UTF8'
  )), 'hex'),
  provider_request_id,
  'owner-learning-failure:' || diagnostic_id,
  occurred_at
FROM legacy_failures;--> statement-breakpoint
INSERT INTO agent_learning_review_failure_manifests (
  id, diagnostic_id, review_id, state, source_pointers, metadata
)
SELECT
  diagnostic.evidence_manifest_id,
  diagnostic.id,
  diagnostic.review_id,
  'legacy_unavailable',
  jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'kind', 'legacy_owner_learning_review_failure',
    'reviewId', diagnostic.review_id,
    'callId', diagnostic.call_id,
    'callOrdinal', diagnostic.call_ordinal,
    'attemptOrdinal', diagnostic.attempt_ordinal
  ))),
  jsonb_strip_nulls(jsonb_build_object(
    'formatVersion', 1,
    'reviewId', diagnostic.review_id,
    'diagnosticId', diagnostic.id,
    'phase', diagnostic.phase,
    'safeFailureCode', diagnostic.safe_failure_code,
    'legacyUncaptured', true,
    'createdAt', diagnostic.occurred_at
  ))
FROM agent_learning_review_failure_diagnostics diagnostic
WHERE diagnostic.error_code = 'legacy_uncaptured'
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
UPDATE agent_learning_review_calls call
SET
  failure_diagnostic_id = diagnostic.id,
  evidence_state = 'legacy_unavailable'
FROM agent_learning_review_failure_diagnostics diagnostic
WHERE diagnostic.call_id = call.id
  AND diagnostic.error_code = 'legacy_uncaptured'
  AND call.failure_diagnostic_id IS NULL;--> statement-breakpoint
UPDATE agent_learning_reviews review
SET
  safe_failure_code = COALESCE(review.safe_failure_code, 'internal_error'),
  retryable = true,
  owner_retry_count = 0
FROM agent_profiles profile
WHERE review.agent_profile_id = profile.id
  AND review.analysis_status = 'failed'
  AND review.resolution IS NULL
  AND review.resolved_at IS NULL
  AND review.owner_retry_count = 0
  AND review.reviewed_revision_id = profile.current_revision_id
  AND review.eligibility_policy_version = 'owner-learning-eligibility-v2'
  AND review.evidence_version = 'owner-learning-evidence-v2'
  AND review.reviewer_version = 'owner-learning-reviewer-v1'
  AND review.prompt_version = 'owner-learning-prompt-v2'
  AND review.schema_version = 'owner-learning-result-v2'
  AND review.provider_policy_version = 'owner-learning-luna-flex-v3'
  AND review.selected_model = 'openai:gpt-5.6-luna'
  AND COALESCE(review.safe_failure_code, 'internal_error') IN (
    'provider_capacity_exhausted',
    'provider_timeout',
    'provider_error',
    'invalid_structured_output',
    'output_budget_exhausted',
    'worker_interrupted',
    'internal_error'
  )
  AND (
    COALESCE(review.safe_failure_code, 'internal_error') NOT IN (
      'provider_capacity_exhausted', 'provider_timeout', 'provider_error'
    )
    OR review.retryable = true
  )
  AND (
    (
      review.checkpoint IS NULL
      AND review.logical_call_count <= 1
      AND review.dive_count <= 1
    ) OR (
      review.checkpoint IS NOT NULL
      AND jsonb_typeof(review.checkpoint) = 'object'
      AND review.checkpoint ->> 'version' = '1'
      AND jsonb_typeof(review.checkpoint -> 'logicalCallCount') = 'number'
      AND jsonb_typeof(review.checkpoint -> 'diveCount') = 'number'
      AND jsonb_typeof(review.checkpoint -> 'nextMomentCursor') = 'number'
      AND review.checkpoint ->> 'logicalCallCount' ~ '^(0|[1-9][0-9]*)$'
      AND review.checkpoint ->> 'diveCount' ~ '^(0|[1-9][0-9]*)$'
      AND review.checkpoint ->> 'nextMomentCursor' ~ '^(0|[1-9][0-9]*)$'
      AND (review.checkpoint ->> 'logicalCallCount')::integer BETWEEN 0 AND 4
      AND (review.checkpoint ->> 'diveCount')::integer BETWEEN 0 AND 3
      AND (review.checkpoint ->> 'nextMomentCursor')::integer >= 0
      AND jsonb_typeof(review.checkpoint -> 'selectedMomentIds') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(review.checkpoint -> 'selectedMomentIds') item
        WHERE jsonb_typeof(item) <> 'string'
      )
      AND jsonb_typeof(review.checkpoint -> 'provisionalThemes') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(review.checkpoint -> 'provisionalThemes') item
        WHERE jsonb_typeof(item) <> 'string'
      )
      AND jsonb_typeof(review.checkpoint -> 'validatedFindings') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(review.checkpoint -> 'validatedFindings') finding
        WHERE jsonb_typeof(finding) <> 'object'
          OR jsonb_typeof(finding -> 'evidenceRefs') <> 'array'
          OR jsonb_typeof(finding -> 'observation') <> 'string'
          OR jsonb_typeof(finding -> 'interpretation') <> 'string'
      )
      AND review.checkpoint ->> 'lastCompletedStage' IN (
        'evidence_ready', 'scanning_narratives', 'investigating_moments',
        'drafting_recommendations', 'complete'
      )
      AND jsonb_typeof(review.checkpoint -> 'promptHash') = 'string'
      AND review.checkpoint ->> 'promptHash' = 'sha256:a6c1a175e2ff65eacb5c8cf1211116c202ba519ec6f3fb5a5eda120da81aea52'
      AND jsonb_typeof(review.checkpoint -> 'schemaHash') = 'string'
      AND review.checkpoint ->> 'schemaHash' = 'sha256:6d4c4ac42856f496b961b335d68fe361b81786dea5bb5b6d0006be0c590721a6'
      AND (
        review.checkpoint -> 'completion' IS NULL
        OR review.checkpoint -> 'completion' = 'null'::jsonb
      )
      AND (review.checkpoint ->> 'logicalCallCount')::integer <= review.logical_call_count
      AND (review.checkpoint ->> 'diveCount')::integer <= review.dive_count
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM agent_learning_review_calls ambiguous_call
    WHERE ambiguous_call.review_id = review.id
      AND ambiguous_call.state IN ('reserved', 'dispatched')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM agent_learning_review_calls ahead_call
    WHERE ahead_call.review_id = review.id
      AND ahead_call.state = 'succeeded'
      AND ahead_call.ordinal > CASE
        WHEN review.checkpoint IS NOT NULL
          AND review.checkpoint ->> 'logicalCallCount' ~ '^(0|[1-9][0-9]*)$'
        THEN (review.checkpoint ->> 'logicalCallCount')::integer
        ELSE 0
      END
  );
--> statement-breakpoint
CREATE FUNCTION owner_learning_validate_invalid_structured_output()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  manifest_state text;
  call_receipt record;
BEGIN
  IF NEW.safe_failure_code <> 'invalid_structured_output' THEN
    RETURN NEW;
  END IF;

  SELECT manifest.state INTO manifest_state
  FROM agent_learning_review_failure_manifests manifest
  WHERE manifest.diagnostic_id = NEW.id
    AND manifest.review_id = NEW.review_id;

  IF NEW.error_code = 'legacy_uncaptured' AND manifest_state = 'legacy_unavailable' THEN
    RETURN NEW;
  END IF;

  SELECT
    call.provider_response_observed_at,
    call.provider_response_sha256,
    call.failure_diagnostic_id,
    call.evidence_state
  INTO call_receipt
  FROM agent_learning_review_calls call
  WHERE call.id = NEW.call_id
    AND call.review_id = NEW.review_id;

  IF NEW.phase IS DISTINCT FROM 'output_validation'
    OR NEW.call_id IS NULL
    OR call_receipt.provider_response_observed_at IS NULL
    OR call_receipt.provider_response_sha256 IS NULL
    OR call_receipt.failure_diagnostic_id IS DISTINCT FROM NEW.id
    OR call_receipt.evidence_state NOT IN ('pending', 'stored', 'degraded')
    OR manifest_state NOT IN ('pending', 'stored', 'degraded')
  THEN
    RAISE EXCEPTION 'invalid_structured_output requires a linked provider response receipt and failure manifest';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER owner_learning_validate_invalid_structured_output_trigger
AFTER INSERT OR UPDATE ON agent_learning_review_failure_diagnostics
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION owner_learning_validate_invalid_structured_output();--> statement-breakpoint
CREATE FUNCTION owner_learning_validate_failed_review_diagnostic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.analysis_status = 'failed'
    AND NOT EXISTS (
      SELECT 1
      FROM agent_learning_review_failure_diagnostics diagnostic
      JOIN agent_learning_review_failure_manifests manifest
        ON manifest.diagnostic_id = diagnostic.id
        AND manifest.review_id = diagnostic.review_id
      JOIN agent_learning_events event
        ON event.review_id = diagnostic.review_id
        AND event.kind = 'review_failed'
        AND event.occurred_at = NEW.updated_at
        AND event.payload ->> 'failureCode' = NEW.safe_failure_code
        AND event.payload -> 'diagnostic' ->> 'diagnosticId' = diagnostic.id
      WHERE diagnostic.review_id = NEW.id
        AND diagnostic.safe_failure_code = NEW.safe_failure_code
    )
  THEN
    RAISE EXCEPTION 'failed owner learning review requires a matching diagnostic, manifest, and review_failed event';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER owner_learning_validate_failed_review_diagnostic_trigger
AFTER INSERT OR UPDATE OF analysis_status, safe_failure_code
ON agent_learning_reviews
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION owner_learning_validate_failed_review_diagnostic();--> statement-breakpoint
CREATE FUNCTION owner_learning_reject_immutable_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER owner_learning_failure_diagnostics_immutable_trigger
BEFORE UPDATE OR DELETE ON agent_learning_review_failure_diagnostics
FOR EACH ROW EXECUTE FUNCTION owner_learning_reject_immutable_audit_mutation();--> statement-breakpoint
CREATE TRIGGER owner_learning_failure_reads_immutable_trigger
BEFORE UPDATE OR DELETE ON agent_learning_review_failure_manifest_reads
FOR EACH ROW EXECUTE FUNCTION owner_learning_reject_immutable_audit_mutation();
