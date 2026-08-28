ALTER TABLE "agent_learning_review_calls" ADD COLUMN "provider_turn_protocol" text DEFAULT 'owner-learning-harness-v2' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD COLUMN "retry_of_execution_fingerprint" text;--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "agent_learning_review_calls_protocol_check" CHECK (char_length("agent_learning_review_calls"."provider_turn_protocol") > 0);
