CREATE TABLE account_text_operations (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), request_key text NOT NULL,
 input_hash text NOT NULL, kind text NOT NULL, model text NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','dispatched','succeeded','failed','uncertain')),
 result jsonb, prompt_tokens integer, completion_tokens integer, estimated_cost_microusd bigint,
 pricing_source text, provider_request_id text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(user_id, request_key), CHECK (estimated_cost_microusd IS NULL OR estimated_cost_microusd >= 0)
);
CREATE INDEX account_text_usage_user_time ON account_text_operations(user_id, created_at);
