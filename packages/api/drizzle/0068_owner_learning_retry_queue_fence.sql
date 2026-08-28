ALTER TABLE "agent_learning_reviews" DROP CONSTRAINT "agent_learning_reviews_analysis_status_check";--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "agent_learning_reviews_analysis_status_check" CHECK (
    "agent_learning_reviews"."analysis_status" IN ('queued', 'retry_queued', 'running', 'ready', 'no_change', 'failed')
  );