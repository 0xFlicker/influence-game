-- Audio artifacts and source documents live in the existing private bucket.
CREATE TABLE agent_voices (
 agent_profile_id text PRIMARY KEY REFERENCES agent_profiles(id) ON DELETE CASCADE,
 assignment jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE game_audio_tracks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 mode text NOT NULL CHECK (mode IN ('live','backfill')), status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','failed','ready')),
 active boolean NOT NULL DEFAULT false, predecessor_id uuid REFERENCES game_audio_tracks(id),
 budget_usd double precision NOT NULL CHECK (budget_usd >= 0 AND budget_usd < 'Infinity'::float8), reserved_characters integer NOT NULL DEFAULT 0 CHECK (reserved_characters >= 0),
 voices_object jsonb NOT NULL, manifest_object jsonb, through_event_sequence integer NOT NULL DEFAULT 0, ready_event_sequence integer NOT NULL DEFAULT 0,
 lease_id uuid, lease_expires_at timestamptz, error text, created_by_id text REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audio_tracks_game_idx ON game_audio_tracks(game_id);
CREATE UNIQUE INDEX audio_tracks_active_unique ON game_audio_tracks(game_id) WHERE active;
CREATE TABLE game_audio_clips (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), track_id uuid NOT NULL REFERENCES game_audio_tracks(id) ON DELETE CASCADE,
 moment_id text NOT NULL, source_hash text NOT NULL, recipe_hash text NOT NULL, recipe_object jsonb NOT NULL,
 active_version_id uuid, attempts integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','failed','ready')), error text,
 CONSTRAINT audio_clips_moment_unique UNIQUE (track_id, moment_id)
);
CREATE TABLE game_audio_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clip_id uuid NOT NULL REFERENCES game_audio_clips(id) ON DELETE CASCADE,
 recipe_hash text NOT NULL, audio_object jsonb NOT NULL, duration_ms double precision NOT NULL CHECK (duration_ms > 0 AND duration_ms < 'Infinity'::float8),
 content_type text NOT NULL DEFAULT 'audio/mpeg', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (clip_id,id)
);
ALTER TABLE game_audio_clips ADD CONSTRAINT audio_clip_active_version FOREIGN KEY (id, active_version_id) REFERENCES game_audio_versions(clip_id,id);
CREATE TABLE game_audio_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clip_id uuid NOT NULL REFERENCES game_audio_clips(id) ON DELETE CASCADE,
 lease_id uuid NOT NULL, status text NOT NULL CHECK (status IN ('dispatched','failed','succeeded')),
 billable_characters integer NOT NULL CHECK (billable_characters >= 0), evidence_object jsonb, response_audio_object jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE game_audio_tracks ADD CONSTRAINT payload_ec09bfe9d996_check CHECK ("game_audio_tracks"."voices_object" IS NULL OR ((
      jsonb_typeof("game_audio_tracks"."voices_object") = 'object'
      AND "game_audio_tracks"."voices_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
      AND ("game_audio_tracks"."voices_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
      AND "game_audio_tracks"."voices_object"->>'storage' = 'private-payload-v1' AND "game_audio_tracks"."voices_object"->>'codec' = 'json-gzip'
      AND "game_audio_tracks"."voices_object"->>'sha256' ~ '^[a-f0-9]{64}$' AND "game_audio_tracks"."voices_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
      AND "game_audio_tracks"."voices_object"->>'key' = 'payloads/v1/json-gzip/' || ("game_audio_tracks"."voices_object"->>'sha256')
      AND jsonb_typeof("game_audio_tracks"."voices_object"->'byteLength') = 'number' AND ("game_audio_tracks"."voices_object"->>'byteLength')::bigint >= 0
      AND jsonb_typeof("game_audio_tracks"."voices_object"->'storedByteLength') = 'number' AND ("game_audio_tracks"."voices_object"->>'storedByteLength')::bigint >= 0
    ) IS TRUE));
ALTER TABLE game_audio_tracks ADD CONSTRAINT payload_3ebab013383e_check CHECK ("game_audio_tracks"."manifest_object" IS NULL OR ((
      jsonb_typeof("game_audio_tracks"."manifest_object") = 'object'
      AND "game_audio_tracks"."manifest_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
      AND ("game_audio_tracks"."manifest_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
      AND "game_audio_tracks"."manifest_object"->>'storage' = 'private-payload-v1' AND "game_audio_tracks"."manifest_object"->>'codec' = 'json-gzip'
      AND "game_audio_tracks"."manifest_object"->>'sha256' ~ '^[a-f0-9]{64}$' AND "game_audio_tracks"."manifest_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
      AND "game_audio_tracks"."manifest_object"->>'key' = 'payloads/v1/json-gzip/' || ("game_audio_tracks"."manifest_object"->>'sha256')
      AND jsonb_typeof("game_audio_tracks"."manifest_object"->'byteLength') = 'number' AND ("game_audio_tracks"."manifest_object"->>'byteLength')::bigint >= 0
      AND jsonb_typeof("game_audio_tracks"."manifest_object"->'storedByteLength') = 'number' AND ("game_audio_tracks"."manifest_object"->>'storedByteLength')::bigint >= 0
    ) IS TRUE));
ALTER TABLE game_audio_clips ADD CONSTRAINT payload_40ad6cd12933_check CHECK ("game_audio_clips"."recipe_object" IS NULL OR ((
      jsonb_typeof("game_audio_clips"."recipe_object") = 'object'
      AND "game_audio_clips"."recipe_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
      AND ("game_audio_clips"."recipe_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
      AND "game_audio_clips"."recipe_object"->>'storage' = 'private-payload-v1' AND "game_audio_clips"."recipe_object"->>'codec' = 'json-gzip'
      AND "game_audio_clips"."recipe_object"->>'sha256' ~ '^[a-f0-9]{64}$' AND "game_audio_clips"."recipe_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
      AND "game_audio_clips"."recipe_object"->>'key' = 'payloads/v1/json-gzip/' || ("game_audio_clips"."recipe_object"->>'sha256')
      AND jsonb_typeof("game_audio_clips"."recipe_object"->'byteLength') = 'number' AND ("game_audio_clips"."recipe_object"->>'byteLength')::bigint >= 0
      AND jsonb_typeof("game_audio_clips"."recipe_object"->'storedByteLength') = 'number' AND ("game_audio_clips"."recipe_object"->>'storedByteLength')::bigint >= 0
    ) IS TRUE));
ALTER TABLE game_audio_versions ADD CONSTRAINT payload_8d1bf85a4bf5_check CHECK ("game_audio_versions"."audio_object" IS NULL OR ((
      jsonb_typeof("game_audio_versions"."audio_object") = 'object'
      AND "game_audio_versions"."audio_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
      AND ("game_audio_versions"."audio_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
      AND "game_audio_versions"."audio_object"->>'storage' = 'private-payload-v1' AND "game_audio_versions"."audio_object"->>'codec' = 'binary'
      AND "game_audio_versions"."audio_object"->>'sha256' ~ '^[a-f0-9]{64}$' AND "game_audio_versions"."audio_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
      AND "game_audio_versions"."audio_object"->>'key' = 'payloads/v1/binary/' || ("game_audio_versions"."audio_object"->>'sha256')
      AND jsonb_typeof("game_audio_versions"."audio_object"->'byteLength') = 'number' AND ("game_audio_versions"."audio_object"->>'byteLength')::bigint >= 0
      AND jsonb_typeof("game_audio_versions"."audio_object"->'storedByteLength') = 'number' AND ("game_audio_versions"."audio_object"->>'storedByteLength')::bigint >= 0
    ) IS TRUE));
ALTER TABLE game_audio_attempts ADD CONSTRAINT payload_39798a76d328_check CHECK ("game_audio_attempts"."evidence_object" IS NULL OR ((
      jsonb_typeof("game_audio_attempts"."evidence_object") = 'object'
      AND "game_audio_attempts"."evidence_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
      AND ("game_audio_attempts"."evidence_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
      AND "game_audio_attempts"."evidence_object"->>'storage' = 'private-payload-v1' AND "game_audio_attempts"."evidence_object"->>'codec' = 'json-gzip'
      AND "game_audio_attempts"."evidence_object"->>'sha256' ~ '^[a-f0-9]{64}$' AND "game_audio_attempts"."evidence_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
      AND "game_audio_attempts"."evidence_object"->>'key' = 'payloads/v1/json-gzip/' || ("game_audio_attempts"."evidence_object"->>'sha256')
      AND jsonb_typeof("game_audio_attempts"."evidence_object"->'byteLength') = 'number' AND ("game_audio_attempts"."evidence_object"->>'byteLength')::bigint >= 0
      AND jsonb_typeof("game_audio_attempts"."evidence_object"->'storedByteLength') = 'number' AND ("game_audio_attempts"."evidence_object"->>'storedByteLength')::bigint >= 0
    ) IS TRUE));

ALTER TABLE game_audio_attempts ADD CONSTRAINT payload_284811c3e875_check CHECK ("game_audio_attempts"."response_audio_object" IS NULL OR ((
      jsonb_typeof("game_audio_attempts"."response_audio_object") = 'object'
      AND "game_audio_attempts"."response_audio_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
      AND ("game_audio_attempts"."response_audio_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
      AND "game_audio_attempts"."response_audio_object"->>'storage' = 'private-payload-v1' AND "game_audio_attempts"."response_audio_object"->>'codec' = 'binary'
      AND "game_audio_attempts"."response_audio_object"->>'sha256' ~ '^[a-f0-9]{64}$' AND "game_audio_attempts"."response_audio_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
      AND "game_audio_attempts"."response_audio_object"->>'key' = 'payloads/v1/binary/' || ("game_audio_attempts"."response_audio_object"->>'sha256')
      AND jsonb_typeof("game_audio_attempts"."response_audio_object"->'byteLength') = 'number' AND ("game_audio_attempts"."response_audio_object"->>'byteLength')::bigint >= 0
      AND jsonb_typeof("game_audio_attempts"."response_audio_object"->'storedByteLength') = 'number' AND ("game_audio_attempts"."response_audio_object"->>'storedByteLength')::bigint >= 0
    ) IS TRUE));
