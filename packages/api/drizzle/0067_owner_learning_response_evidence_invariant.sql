CREATE OR REPLACE FUNCTION owner_learning_validate_invalid_structured_output()
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
    call.response_evidence_body,
    call.response_evidence_body_sha256,
    call.response_evidence_byte_length,
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
    OR call_receipt.response_evidence_body IS NULL
    OR call_receipt.response_evidence_body_sha256 IS NULL
    OR call_receipt.response_evidence_byte_length IS NULL
    OR call_receipt.failure_diagnostic_id IS DISTINCT FROM NEW.id
    OR call_receipt.evidence_state NOT IN ('pending', 'stored', 'degraded')
    OR manifest_state NOT IN ('pending', 'stored', 'degraded')
  THEN
    RAISE EXCEPTION 'invalid_structured_output requires linked byte-complete provider response evidence and a failure manifest';
  END IF;
  RETURN NEW;
END;
$$;
