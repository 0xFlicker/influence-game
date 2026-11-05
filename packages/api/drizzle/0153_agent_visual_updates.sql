CREATE TABLE agent_visual_updates (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), agent_id text NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
 source_updated_at text NOT NULL, source_content_id text, input_object jsonb NOT NULL, checkpoint_object jsonb NOT NULL,
 status text NOT NULL CHECK (status IN ('queued','processing','failed','conflict','completed','held')),
 stage text NOT NULL CHECK (stage IN ('details','body','head','portrait','saving')), attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
 lease_id text, lease_until text, error_code text, result_revision_id text,
 created_at text NOT NULL DEFAULT now()::text, updated_at text NOT NULL DEFAULT now()::text
);
--> statement-breakpoint
CREATE INDEX agent_visual_updates_agent_idx ON agent_visual_updates(agent_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_visual_updates_active_idx ON agent_visual_updates(agent_id) WHERE status IN ('queued','processing');
--> statement-breakpoint
ALTER TABLE agent_visual_updates ADD CONSTRAINT payload_655bb10afaaf_check CHECK ((jsonb_typeof(input_object)='object' AND input_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength'] AND (input_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength'])='{}'::jsonb AND input_object->>'storage'='private-payload-v1' AND input_object->>'codec'='json-gzip' AND input_object->>'sha256' ~ '^[a-f0-9]{64}$' AND input_object->>'storedSha256' ~ '^[a-f0-9]{64}$' AND input_object->>'key'='payloads/v1/json-gzip/' || (input_object->>'sha256') AND jsonb_typeof(input_object->'byteLength')='number' AND (input_object->>'byteLength')::bigint >= 0 AND jsonb_typeof(input_object->'storedByteLength')='number' AND (input_object->>'storedByteLength')::bigint >= 0) IS TRUE);
--> statement-breakpoint
ALTER TABLE agent_visual_updates ADD CONSTRAINT payload_5dbd50d73a53_check CHECK ((jsonb_typeof(checkpoint_object)='object' AND checkpoint_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength'] AND (checkpoint_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength'])='{}'::jsonb AND checkpoint_object->>'storage'='private-payload-v1' AND checkpoint_object->>'codec'='json-gzip' AND checkpoint_object->>'sha256' ~ '^[a-f0-9]{64}$' AND checkpoint_object->>'storedSha256' ~ '^[a-f0-9]{64}$' AND checkpoint_object->>'key'='payloads/v1/json-gzip/' || (checkpoint_object->>'sha256') AND jsonb_typeof(checkpoint_object->'byteLength')='number' AND (checkpoint_object->>'byteLength')::bigint >= 0 AND jsonb_typeof(checkpoint_object->'storedByteLength')='number' AND (checkpoint_object->>'storedByteLength')::bigint >= 0) IS TRUE);
