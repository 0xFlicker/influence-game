ALTER TABLE "agent_learning_review_calls" ADD COLUMN "request_evidence_body" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "request_evidence_sha256" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "request_evidence_byte_length" integer;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "response_evidence_body" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "response_evidence_body_sha256" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "response_evidence_byte_length" integer;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "agent_learning_review_calls_request_evidence_check" CHECK (
    (
      "agent_learning_review_calls"."request_evidence_body" IS NULL
      AND "agent_learning_review_calls"."request_evidence_sha256" IS NULL
      AND "agent_learning_review_calls"."request_evidence_byte_length" IS NULL
    ) OR (
      "agent_learning_review_calls"."request_evidence_body" IS NOT NULL
      AND "agent_learning_review_calls"."request_evidence_sha256" LIKE 'sha256:%'
      AND "agent_learning_review_calls"."request_evidence_byte_length" > 0
    )
  );--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "agent_learning_review_calls_response_evidence_check" CHECK (
    (
      "agent_learning_review_calls"."response_evidence_body" IS NULL
      AND "agent_learning_review_calls"."response_evidence_body_sha256" IS NULL
      AND "agent_learning_review_calls"."response_evidence_byte_length" IS NULL
    ) OR (
      "agent_learning_review_calls"."response_evidence_body" IS NOT NULL
      AND "agent_learning_review_calls"."response_evidence_body_sha256" LIKE 'sha256:%'
      AND "agent_learning_review_calls"."response_evidence_byte_length" > 0
      AND "agent_learning_review_calls"."provider_response_observed_at" IS NOT NULL
      AND "agent_learning_review_calls"."provider_response_sha256" LIKE 'sha256:%'
    )
  );
