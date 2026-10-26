-- Some development databases applied the initial audio migration before response retention landed.
-- Preserve migration history and add the missing nullable bucket reference in place.
ALTER TABLE game_audio_attempts ADD COLUMN IF NOT EXISTS response_audio_object jsonb;
--> statement-breakpoint
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'game_audio_attempts'::regclass AND conname = 'payload_284811c3e875_check') THEN
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
END IF;
END $$;
