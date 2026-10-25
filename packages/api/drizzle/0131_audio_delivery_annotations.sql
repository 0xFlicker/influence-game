-- New bucket reference only. Historical calls had no delivery annotations;
-- keep them NULL and never regenerate or rewrite their accepted evidence.
ALTER TABLE provider_logical_calls ADD COLUMN audio_delivery_object jsonb;
--> statement-breakpoint
ALTER TABLE provider_logical_calls ADD CONSTRAINT payload_936417b32d30_check CHECK (audio_delivery_object IS NULL OR ((
  jsonb_typeof(audio_delivery_object) = 'object'
  AND audio_delivery_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND (audio_delivery_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND audio_delivery_object->>'storage' = 'private-payload-v1'
  AND audio_delivery_object->>'codec' = 'json-gzip'
  AND audio_delivery_object->>'sha256' ~ '^[a-f0-9]{64}$'
  AND audio_delivery_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND audio_delivery_object->>'key' = 'payloads/v1/json-gzip/' || (audio_delivery_object->>'sha256')
  AND jsonb_typeof(audio_delivery_object->'byteLength') = 'number' AND (audio_delivery_object->>'byteLength')::bigint >= 0
  AND jsonb_typeof(audio_delivery_object->'storedByteLength') = 'number' AND (audio_delivery_object->>'storedByteLength')::bigint >= 0
) IS TRUE));
--> statement-breakpoint
ALTER TABLE provider_logical_calls ADD CONSTRAINT provider_logical_calls_audio_delivery_accepted
  CHECK (audio_delivery_object IS NULL OR accepted_attempt_id IS NOT NULL);
