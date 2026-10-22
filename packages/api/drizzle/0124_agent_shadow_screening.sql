CREATE TABLE agent_screenings (
 id text PRIMARY KEY, content_revision_id text NOT NULL REFERENCES agent_content_revisions(id),
 policy_version text NOT NULL, status text NOT NULL DEFAULT 'pending', recommendation text,
 result_object jsonb, owner text, lease_until timestamptz, failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 CONSTRAINT agent_screenings_status_check CHECK (status IN ('pending','running','completed','incomplete')),
 CONSTRAINT agent_screenings_recommendation_check CHECK (recommendation IS NULL OR recommendation IN ('no_concern','review','inconclusive'))
);
CREATE UNIQUE INDEX agent_screenings_revision_policy_unique ON agent_screenings(content_revision_id, policy_version);
CREATE INDEX agent_screenings_pending_idx ON agent_screenings(status, created_at);
CREATE TABLE agent_screening_attempts (
 id text PRIMARY KEY, screening_id text NOT NULL REFERENCES agent_screenings(id), stage text NOT NULL,
 ordinal integer NOT NULL, request_object jsonb NOT NULL, response_object jsonb, outcome text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT agent_screening_attempt_stage_check CHECK (stage IN ('moderation','luna')),
 CONSTRAINT agent_screening_attempt_ordinal_check CHECK (ordinal BETWEEN 1 AND 3),
 CONSTRAINT agent_screening_attempt_outcome_check CHECK (outcome IS NULL OR outcome IN ('accepted','retryable','failed'))
);
CREATE UNIQUE INDEX agent_screening_attempt_unique ON agent_screening_attempts(screening_id,stage,ordinal);
ALTER TABLE agent_screenings ADD CONSTRAINT payload_4576d7034668_check CHECK (result_object IS NULL OR ((jsonb_typeof(result_object) = 'object' AND result_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength'] AND (result_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb AND result_object->>'storage' = 'private-payload-v1' AND result_object->>'codec' = 'json-gzip' AND result_object->>'sha256' ~ '^[a-f0-9]{64}$' AND result_object->>'storedSha256' ~ '^[a-f0-9]{64}$' AND result_object->>'key' = 'payloads/v1/json-gzip/' || (result_object->>'sha256') AND jsonb_typeof(result_object->'byteLength') = 'number' AND (result_object->>'byteLength')::bigint >= 0 AND jsonb_typeof(result_object->'storedByteLength') = 'number' AND (result_object->>'storedByteLength')::bigint >= 0) IS TRUE));
ALTER TABLE agent_screening_attempts ADD CONSTRAINT payload_c75e0d0c2305_check CHECK (request_object IS NULL OR ((jsonb_typeof(request_object) = 'object' AND request_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength'] AND (request_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb AND request_object->>'storage' = 'private-payload-v1' AND request_object->>'codec' = 'json-gzip' AND request_object->>'sha256' ~ '^[a-f0-9]{64}$' AND request_object->>'storedSha256' ~ '^[a-f0-9]{64}$' AND request_object->>'key' = 'payloads/v1/json-gzip/' || (request_object->>'sha256') AND jsonb_typeof(request_object->'byteLength') = 'number' AND (request_object->>'byteLength')::bigint >= 0 AND jsonb_typeof(request_object->'storedByteLength') = 'number' AND (request_object->>'storedByteLength')::bigint >= 0) IS TRUE));
ALTER TABLE agent_screening_attempts ADD CONSTRAINT payload_1ec3c413d7ee_check CHECK (response_object IS NULL OR ((jsonb_typeof(response_object) = 'object' AND response_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength'] AND (response_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb AND response_object->>'storage' = 'private-payload-v1' AND response_object->>'codec' = 'json-gzip' AND response_object->>'sha256' ~ '^[a-f0-9]{64}$' AND response_object->>'storedSha256' ~ '^[a-f0-9]{64}$' AND response_object->>'key' = 'payloads/v1/json-gzip/' || (response_object->>'sha256') AND jsonb_typeof(response_object->'byteLength') = 'number' AND (response_object->>'byteLength')::bigint >= 0 AND jsonb_typeof(response_object->'storedByteLength') = 'number' AND (response_object->>'storedByteLength')::bigint >= 0) IS TRUE));
-- Queue current published and submitted snapshots without reopening human reviews or changing profiles.
INSERT INTO agent_screenings(id, content_revision_id, policy_version)
SELECT gen_random_uuid()::text, r.id, 'house-agent-shadow-v1' FROM agent_content_revisions r
WHERE EXISTS (SELECT 1 FROM agent_profiles p WHERE p.content_revision_id = r.id OR p.latest_content_revision_id = r.id)
ON CONFLICT DO NOTHING;
