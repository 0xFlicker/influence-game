CREATE TABLE anonymous_text_operations (
 id text PRIMARY KEY, visitor_hash text NOT NULL, request_key text NOT NULL,
 input_hash text NOT NULL, model text NOT NULL,
 state text NOT NULL CHECK (state IN ('dispatched','succeeded','failed','uncertain')),
 result jsonb, prompt_tokens integer, completion_tokens integer,
 estimated_cost_microusd bigint, pricing_source text, provider_request_id text,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(visitor_hash, request_key)
);
CREATE INDEX anonymous_text_operations_visitor ON anonymous_text_operations(visitor_hash);
CREATE INDEX anonymous_text_operations_time ON anonymous_text_operations(created_at);
