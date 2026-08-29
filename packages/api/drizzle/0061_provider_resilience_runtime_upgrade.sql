ALTER TABLE "provider_attempt_evidence_outbox" ADD COLUMN IF NOT EXISTS "reconciliation_attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" ADD COLUMN IF NOT EXISTS "next_reconciliation_at" text DEFAULT now()::text NOT NULL;
--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" ADD COLUMN IF NOT EXISTS "claim_token" text;
--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" ADD COLUMN IF NOT EXISTS "claim_expires_at" text;
--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" ADD CONSTRAINT "provider_attempt_evidence_outbox_reconciliation_shape_check" CHECK (
  "reconciliation_attempt_count" >= 0
  AND (
    ("claim_token" IS NULL AND "claim_expires_at" IS NULL)
    OR ("claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_attempt_evidence_outbox_ready_idx" ON "provider_attempt_evidence_outbox" USING btree ("next_reconciliation_at","claim_expires_at","created_at");
--> statement-breakpoint
ALTER TABLE "provider_call_attempts" DROP CONSTRAINT IF EXISTS "provider_call_attempts_outcome_check";
--> statement-breakpoint
ALTER TABLE "provider_call_attempts" ADD CONSTRAINT "provider_call_attempts_outcome_check" CHECK ("provider_call_attempts"."outcome_kind" IS NULL OR "provider_call_attempts"."outcome_kind" IN (
  'usable', 'refusal', 'rate_limit', 'service_error',
  'transport_timeout', 'transport_error', 'authentication',
  'configuration', 'request_error', 'cancellation', 'empty_output', 'malformed_output',
  'wrong_tool', 'undecodable_structured_output'
));
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN IF NOT EXISTS "accepted_attempt_id" text;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN IF NOT EXISTS "accepted_catalog_id" text;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN IF NOT EXISTS "accepted_value" jsonb;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN IF NOT EXISTS "accepted_value_sha256" text;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN IF NOT EXISTS "accepted_at" text;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN IF NOT EXISTS "canonical_event_sequence" integer;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD COLUMN IF NOT EXISTS "canonical_committed_at" text;
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" DROP CONSTRAINT IF EXISTS "provider_logical_calls_accepted_shape_check";
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD CONSTRAINT "provider_logical_calls_accepted_shape_check" CHECK (
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
);
