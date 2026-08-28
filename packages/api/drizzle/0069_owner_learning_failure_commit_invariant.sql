DROP TRIGGER IF EXISTS owner_learning_capture_uncaptured_failure_trigger
ON agent_learning_reviews;--> statement-breakpoint
DROP FUNCTION IF EXISTS owner_learning_capture_uncaptured_failure();--> statement-breakpoint
CREATE OR REPLACE FUNCTION owner_learning_validate_failed_review_diagnostic()
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
$$;
