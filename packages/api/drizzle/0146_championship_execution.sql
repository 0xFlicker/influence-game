CREATE TABLE season_finalizations (season_id text PRIMARY KEY REFERENCES seasons(id), snapshot_object jsonb NOT NULL);
--> statement-breakpoint
ALTER TABLE championship_events ADD COLUMN execution_object jsonb;
--> statement-breakpoint
ALTER TABLE season_finalizations ADD CONSTRAINT payload_741a95184cae_check CHECK (snapshot_object IS NULL OR ((
 jsonb_typeof(snapshot_object) = 'object'
 AND snapshot_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (snapshot_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND snapshot_object->>'storage' = 'private-payload-v1' AND snapshot_object->>'codec' = 'json-gzip'
 AND snapshot_object->>'sha256' ~ '^[a-f0-9]{64}$' AND snapshot_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND snapshot_object->>'key' = 'payloads/v1/json-gzip/' || (snapshot_object->>'sha256')
 AND jsonb_typeof(snapshot_object->'byteLength') = 'number' AND (snapshot_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(snapshot_object->'storedByteLength') = 'number' AND (snapshot_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));

--> statement-breakpoint
ALTER TABLE championship_events ADD CONSTRAINT payload_7fe500bac930_check CHECK (execution_object IS NULL OR ((
 jsonb_typeof(execution_object) = 'object'
 AND execution_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (execution_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND execution_object->>'storage' = 'private-payload-v1' AND execution_object->>'codec' = 'json-gzip'
 AND execution_object->>'sha256' ~ '^[a-f0-9]{64}$' AND execution_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND execution_object->>'key' = 'payloads/v1/json-gzip/' || (execution_object->>'sha256')
 AND jsonb_typeof(execution_object->'byteLength') = 'number' AND (execution_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(execution_object->'storedByteLength') = 'number' AND (execution_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));

--> statement-breakpoint
CREATE TABLE championship_results (match_id text NOT NULL REFERENCES championship_matches(id), entry_id text NOT NULL REFERENCES championship_entries(id), outcome text NOT NULL, points integer NOT NULL, policy_version text NOT NULL, canonical_sequence integer, PRIMARY KEY(match_id,entry_id), CONSTRAINT championship_result_outcome CHECK(outcome IN ('win','loss','draw')));
--> statement-breakpoint
CREATE TABLE championship_award_allocations (id text PRIMARY KEY, event_id text NOT NULL REFERENCES championship_events(id), phase text NOT NULL, grants_object jsonb NOT NULL, delivered_at text, CONSTRAINT championship_awards_phase UNIQUE(event_id,phase));
--> statement-breakpoint
ALTER TABLE championship_award_allocations ADD CONSTRAINT payload_6f207d19e716_check CHECK (grants_object IS NULL OR ((
 jsonb_typeof(grants_object) = 'object'
 AND grants_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (grants_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND grants_object->>'storage' = 'private-payload-v1' AND grants_object->>'codec' = 'json-gzip'
 AND grants_object->>'sha256' ~ '^[a-f0-9]{64}$' AND grants_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND grants_object->>'key' = 'payloads/v1/json-gzip/' || (grants_object->>'sha256')
 AND jsonb_typeof(grants_object->'byteLength') = 'number' AND (grants_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(grants_object->'storedByteLength') = 'number' AND (grants_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
