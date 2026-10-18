ALTER TABLE provider_call_attempts ADD COLUMN context_source_hash text;
ALTER TABLE provider_call_attempts ADD COLUMN context_revision integer;
ALTER TABLE provider_call_attempts ADD CONSTRAINT provider_call_attempts_context_check CHECK (
  (context_source_hash IS NULL AND context_revision IS NULL) OR
  (context_source_hash IS NOT NULL AND context_revision IS NOT NULL AND context_source_hash ~ '^sha256:[a-f0-9]{64}$' AND context_revision BETWEEN 0 AND 3)
);
ALTER TABLE provider_call_attempts DROP CONSTRAINT provider_call_attempts_outcome_check;
ALTER TABLE provider_call_attempts ADD CONSTRAINT provider_call_attempts_outcome_check CHECK (
  outcome_kind IS NULL OR outcome_kind IN ('usable', 'refusal', 'rate_limit', 'service_error',
  'transport_timeout', 'transport_error', 'authentication', 'configuration', 'request_error',
  'context_overflow', 'cancellation', 'empty_output', 'malformed_output', 'wrong_tool', 'undecodable_structured_output')
);
