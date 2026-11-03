ALTER TABLE championship_events DROP CONSTRAINT championship_events_status;
--> statement-breakpoint
ALTER TABLE championship_events ADD CONSTRAINT championship_events_status CHECK (status IN ('draft','preparing','locked','running','paused','final'));
--> statement-breakpoint
ALTER TABLE championship_events ADD COLUMN lock_requested_by_id text REFERENCES users(id), ADD COLUMN lock_request_id text;
--> statement-breakpoint
CREATE TABLE championship_artwork (
 id text PRIMARY KEY, event_id text NOT NULL REFERENCES championship_events(id), agent_id text NOT NULL REFERENCES agent_profiles(id),
 owner_id text NOT NULL REFERENCES users(id), qualification_rank integer NOT NULL, season_points integer NOT NULL,
 selected boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'queued', input_object jsonb NOT NULL, avatar_object jsonb, body_object jsonb,
 avatar_url text, body_url text, lease_id text, lease_until text, next_attempt_at text, last_error text,
 CONSTRAINT championship_artwork_agent UNIQUE(event_id,agent_id),
 CONSTRAINT championship_artwork_status CHECK(status IN ('queued','processing','ready','retry'))
);
--> statement-breakpoint
ALTER TABLE championship_artwork ADD CONSTRAINT payload_5fe7512541bd_check CHECK (input_object IS NULL OR ((
 jsonb_typeof(input_object) = 'object' AND input_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (input_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND input_object->>'storage' = 'private-payload-v1' AND input_object->>'codec' = 'json-gzip'
 AND input_object->>'sha256' ~ '^[a-f0-9]{64}$' AND input_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND input_object->>'key' = 'payloads/v1/json-gzip/' || (input_object->>'sha256')
 AND jsonb_typeof(input_object->'byteLength') = 'number' AND (input_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(input_object->'storedByteLength') = 'number' AND (input_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE championship_artwork ADD CONSTRAINT payload_3d5cb5dcff34_check CHECK (avatar_object IS NULL OR ((
 jsonb_typeof(avatar_object) = 'object' AND avatar_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (avatar_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND avatar_object->>'storage' = 'private-payload-v1' AND avatar_object->>'codec' = 'binary'
 AND avatar_object->>'sha256' ~ '^[a-f0-9]{64}$' AND avatar_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND avatar_object->>'key' = 'payloads/v1/binary/' || (avatar_object->>'sha256')
 AND jsonb_typeof(avatar_object->'byteLength') = 'number' AND (avatar_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(avatar_object->'storedByteLength') = 'number' AND (avatar_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE championship_artwork ADD CONSTRAINT payload_4232d09f06b8_check CHECK (body_object IS NULL OR ((
 jsonb_typeof(body_object) = 'object' AND body_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (body_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND body_object->>'storage' = 'private-payload-v1' AND body_object->>'codec' = 'binary'
 AND body_object->>'sha256' ~ '^[a-f0-9]{64}$' AND body_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND body_object->>'key' = 'payloads/v1/binary/' || (body_object->>'sha256')
 AND jsonb_typeof(body_object->'byteLength') = 'number' AND (body_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(body_object->'storedByteLength') = 'number' AND (body_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
