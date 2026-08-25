ALTER TABLE "provider_call_attempts" DROP CONSTRAINT IF EXISTS "provider_call_attempts_request_shape_check";
--> statement-breakpoint
UPDATE "provider_call_attempts"
SET "request_shape" = CASE
  WHEN "request_shape" = 'responses' THEN 'openai.responses'
  WHEN "request_shape" = 'chat_completions' THEN "provider_profile_id" || '.chat_completions'
  ELSE "request_shape"
END;
--> statement-breakpoint
ALTER TABLE "provider_call_attempts" ADD CONSTRAINT "provider_call_attempts_request_shape_check" CHECK (
  "request_shape" IN ('chat_completions', 'responses')
  OR (
    char_length("request_shape") BETWEEN 3 AND 80
    AND "request_shape" ~ '^[a-z][a-z0-9-]*([.][a-z][a-z0-9_-]*)+$'
  )
);
