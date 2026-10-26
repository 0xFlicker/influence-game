CREATE TABLE character_cutouts (
 id text PRIMARY KEY, source_hash text NOT NULL, recipe text NOT NULL,
 source_object jsonb NOT NULL, image_object jsonb, width integer NOT NULL, height integer NOT NULL,
 status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 token_hash text, lease_until timestamptz, batch_job_id text, error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT character_cutouts_state CHECK (status IN ('pending','submitted','running','ready','failed') AND (status <> 'ready' OR image_object IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX character_cutouts_source_recipe ON character_cutouts(source_hash,recipe);
--> statement-breakpoint
CREATE INDEX character_cutouts_status ON character_cutouts(status,lease_until);
--> statement-breakpoint
CREATE TABLE character_cutout_demands (
 id text PRIMARY KEY, game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 player_id text NOT NULL, source_key text NOT NULL, recipe text NOT NULL,
 cutout_id text REFERENCES character_cutouts(id), error text, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX character_cutout_demands_source ON character_cutout_demands(game_id,player_id,source_key,recipe);
--> statement-breakpoint
ALTER TABLE character_cutouts ADD CONSTRAINT payload_1e3554e913fc_check CHECK (source_object IS NULL OR ((
 jsonb_typeof(source_object) = 'object'
 AND source_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (source_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND source_object->>'storage' = 'private-payload-v1' AND source_object->>'codec' = 'binary'
 AND source_object->>'sha256' ~ '^[a-f0-9]{64}$' AND source_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND source_object->>'key' = 'payloads/v1/binary/' || (source_object->>'sha256')
 AND jsonb_typeof(source_object->'byteLength') = 'number' AND (source_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(source_object->'storedByteLength') = 'number' AND (source_object->>'storedByteLength')::bigint >= 0
) IS TRUE));
--> statement-breakpoint
ALTER TABLE character_cutouts ADD CONSTRAINT payload_fe26fa742188_check CHECK (image_object IS NULL OR ((
 jsonb_typeof(image_object) = 'object'
 AND image_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (image_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND image_object->>'storage' = 'private-payload-v1' AND image_object->>'codec' = 'binary'
 AND image_object->>'sha256' ~ '^[a-f0-9]{64}$' AND image_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND image_object->>'key' = 'payloads/v1/binary/' || (image_object->>'sha256')
 AND jsonb_typeof(image_object->'byteLength') = 'number' AND (image_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(image_object->'storedByteLength') = 'number' AND (image_object->>'storedByteLength')::bigint >= 0
) IS TRUE));
--> statement-breakpoint
