CREATE TABLE render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL DEFAULT gen_random_uuid(),
  game_id text NOT NULL REFERENCES games(id),
  requested_by text REFERENCES users(id),
  request_key text NOT NULL,
  request_hash text NOT NULL,
  workload text NOT NULL CHECK (workload IN ('trailer','studio-export')),
  source_render_version integer,
  input_object jsonb NOT NULL,
  receipt_object jsonb CHECK (receipt_object IS NULL OR ((
    jsonb_typeof(receipt_object) = 'object'
    AND receipt_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
    AND (receipt_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
    AND receipt_object->>'storage' = 'private-payload-v1' AND receipt_object->>'codec' = 'json-gzip'
    AND receipt_object->>'sha256' ~ '^[a-f0-9]{64}$' AND receipt_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
    AND receipt_object->>'key' = 'payloads/v1/json-gzip/' || (receipt_object->>'sha256')
    AND jsonb_typeof(receipt_object->'byteLength') = 'number' AND (receipt_object->>'byteLength')::bigint >= 0
    AND jsonb_typeof(receipt_object->'storedByteLength') = 'number' AND (receipt_object->>'storedByteLength')::bigint >= 0
  ) IS TRUE)),
  state text NOT NULL DEFAULT 'uploading_inputs' CHECK (state IN ('uploading_inputs','queued','rendering','uploading','verifying','succeeded','failed','cancelled')),
  renderer_digest text NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  lease_hash text, lease_expires_at text, worker_id text, batch_id text,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  failure text, output_key text, output_hash text, output_bytes bigint,
  created_at text NOT NULL DEFAULT now()::text,
  updated_at text NOT NULL DEFAULT now()::text,
  CONSTRAINT render_jobs_input_reference CHECK (
    (jsonb_typeof(input_object) = 'object'
    AND input_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
    AND (input_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
    AND input_object->>'storage' = 'private-payload-v1'
    AND input_object->>'codec' = 'json-gzip'
    AND input_object->>'sha256' ~ '^[a-f0-9]{64}$'
    AND input_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
    AND input_object->>'key' = 'payloads/v1/json-gzip/' || (input_object->>'sha256')
    AND jsonb_typeof(input_object->'byteLength') = 'number' AND (input_object->>'byteLength')::bigint >= 0
    AND jsonb_typeof(input_object->'storedByteLength') = 'number' AND (input_object->>'storedByteLength')::bigint >= 0) IS TRUE
  )
);
CREATE UNIQUE INDEX render_jobs_request_idx ON render_jobs(requested_by,request_key) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX render_jobs_trailer_version_idx ON render_jobs(game_id,source_render_version) WHERE workload='trailer';
CREATE INDEX render_jobs_state_idx ON render_jobs(state,created_at);
