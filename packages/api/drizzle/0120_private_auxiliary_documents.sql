-- Coordinated cutover: stop all writers, run storage:copy and storage:verify first.
-- Every non-null body must match a verified copy receipt. No fallback or empty-body substitution.
CREATE TABLE IF NOT EXISTS storage_payload_migration_receipts (
 source_table text NOT NULL, source_column text NOT NULL, row_key jsonb NOT NULL,
 source_sha256 text NOT NULL, object_reference jsonb NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (source_table,source_column,row_key)
);
--> statement-breakpoint
CREATE FUNCTION storage_payload_cutover_reference(source_table_name text, source_column_name text, source_row_key jsonb, source_bytes bytea)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE receipt storage_payload_migration_receipts%ROWTYPE;
BEGIN
 IF source_bytes IS NULL THEN RETURN NULL; END IF;
 IF current_setting('influence.storage_cutover', true) IS DISTINCT FROM 'writers-stopped'
 THEN RAISE EXCEPTION 'Storage migration requires the coordinated storage:cutover command with all writers stopped'; END IF;
 SELECT * INTO receipt FROM storage_payload_migration_receipts r
 WHERE r.source_table=source_table_name AND r.source_column=source_column_name AND r.row_key=source_row_key;
 IF NOT FOUND OR receipt.source_sha256 <> encode(sha256(source_bytes),'hex')
   OR receipt.object_reference->>'sha256' IS DISTINCT FROM receipt.source_sha256
   OR (receipt.object_reference->>'byteLength')::bigint IS DISTINCT FROM octet_length(source_bytes)::bigint
 THEN RAISE EXCEPTION 'Unverified or changed storage payload %.% (%)', source_table_name,source_column_name,source_row_key; END IF;
 RETURN receipt.object_reference;
END $$;
--> statement-breakpoint
LOCK TABLE "account_text_operations","agent_revisions","anonymous_text_operations","visual_media_requests","provider_health_probe_evidence" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE "agent_revisions" ALTER COLUMN "behavior_snapshot" TYPE jsonb USING storage_payload_cutover_reference('agent_revisions','behavior_snapshot',jsonb_build_object('id',"id"),convert_to("behavior_snapshot"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_revisions" RENAME COLUMN "behavior_snapshot" TO "behavior_snapshot_object";
--> statement-breakpoint
ALTER TABLE "agent_revisions" ADD CONSTRAINT "payload_f53c6e7dffe5_check" CHECK ("behavior_snapshot_object" IS NULL OR ((
  jsonb_typeof("behavior_snapshot_object") = 'object'
  AND "behavior_snapshot_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("behavior_snapshot_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "behavior_snapshot_object"->>'storage' = 'private-payload-v1'
  AND "behavior_snapshot_object"->>'codec' = 'json-gzip'
  AND "behavior_snapshot_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "behavior_snapshot_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "behavior_snapshot_object"->>'key' = 'payloads/v1/json-gzip/' || ("behavior_snapshot_object"->>'sha256')
  AND jsonb_typeof("behavior_snapshot_object"->'byteLength') = 'number' AND ("behavior_snapshot_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("behavior_snapshot_object"->'storedByteLength') = 'number' AND ("behavior_snapshot_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_revisions" ALTER COLUMN "effective_runtime_snapshot" TYPE jsonb USING storage_payload_cutover_reference('agent_revisions','effective_runtime_snapshot',jsonb_build_object('id',"id"),convert_to("effective_runtime_snapshot"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_revisions" RENAME COLUMN "effective_runtime_snapshot" TO "effective_runtime_snapshot_object";
--> statement-breakpoint
ALTER TABLE "agent_revisions" ADD CONSTRAINT "payload_aa2eeb055cec_check" CHECK ("effective_runtime_snapshot_object" IS NULL OR ((
  jsonb_typeof("effective_runtime_snapshot_object") = 'object'
  AND "effective_runtime_snapshot_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("effective_runtime_snapshot_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "effective_runtime_snapshot_object"->>'storage' = 'private-payload-v1'
  AND "effective_runtime_snapshot_object"->>'codec' = 'json-gzip'
  AND "effective_runtime_snapshot_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "effective_runtime_snapshot_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "effective_runtime_snapshot_object"->>'key' = 'payloads/v1/json-gzip/' || ("effective_runtime_snapshot_object"->>'sha256')
  AND jsonb_typeof("effective_runtime_snapshot_object"->'byteLength') = 'number' AND ("effective_runtime_snapshot_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("effective_runtime_snapshot_object"->'storedByteLength') = 'number' AND ("effective_runtime_snapshot_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "account_text_operations" ALTER COLUMN "result" TYPE jsonb USING storage_payload_cutover_reference('account_text_operations','result',jsonb_build_object('id',"id"),convert_to("result"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "account_text_operations" RENAME COLUMN "result" TO "result_object";
--> statement-breakpoint
ALTER TABLE "account_text_operations" ADD CONSTRAINT "payload_068fd460a699_check" CHECK ("result_object" IS NULL OR ((
  jsonb_typeof("result_object") = 'object'
  AND "result_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("result_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "result_object"->>'storage' = 'private-payload-v1'
  AND "result_object"->>'codec' = 'json-gzip'
  AND "result_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "result_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "result_object"->>'key' = 'payloads/v1/json-gzip/' || ("result_object"->>'sha256')
  AND jsonb_typeof("result_object"->'byteLength') = 'number' AND ("result_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("result_object"->'storedByteLength') = 'number' AND ("result_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "anonymous_text_operations" ALTER COLUMN "result" TYPE jsonb USING storage_payload_cutover_reference('anonymous_text_operations','result',jsonb_build_object('id',"id"),convert_to("result"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "anonymous_text_operations" RENAME COLUMN "result" TO "result_object";
--> statement-breakpoint
ALTER TABLE "anonymous_text_operations" ADD CONSTRAINT "payload_bc539e6ef8a8_check" CHECK ("result_object" IS NULL OR ((
  jsonb_typeof("result_object") = 'object'
  AND "result_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("result_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "result_object"->>'storage' = 'private-payload-v1'
  AND "result_object"->>'codec' = 'json-gzip'
  AND "result_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "result_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "result_object"->>'key' = 'payloads/v1/json-gzip/' || ("result_object"->>'sha256')
  AND jsonb_typeof("result_object"->'byteLength') = 'number' AND ("result_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("result_object"->'storedByteLength') = 'number' AND ("result_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "visual_media_requests" ALTER COLUMN "input" TYPE jsonb USING storage_payload_cutover_reference('visual_media_requests','input',jsonb_build_object('id',"id"),convert_to("input"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "visual_media_requests" RENAME COLUMN "input" TO "input_object";
--> statement-breakpoint
ALTER TABLE "visual_media_requests" ADD CONSTRAINT "payload_0dbf620e7321_check" CHECK ("input_object" IS NULL OR ((
  jsonb_typeof("input_object") = 'object'
  AND "input_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("input_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "input_object"->>'storage' = 'private-payload-v1'
  AND "input_object"->>'codec' = 'json-gzip'
  AND "input_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "input_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "input_object"->>'key' = 'payloads/v1/json-gzip/' || ("input_object"->>'sha256')
  AND jsonb_typeof("input_object"->'byteLength') = 'number' AND ("input_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("input_object"->'storedByteLength') = 'number' AND ("input_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint

ALTER TABLE "provider_health_probe_evidence" ALTER COLUMN "record" TYPE jsonb USING storage_payload_cutover_reference('provider_health_probe_evidence','record',jsonb_build_object('id',"id"),convert_to("record"::text,'UTF8'));

--> statement-breakpoint

ALTER TABLE "provider_health_probe_evidence" RENAME COLUMN "record" TO "record_object";

--> statement-breakpoint

ALTER TABLE "provider_health_probe_evidence" ADD CONSTRAINT "payload_e51421ebc3a9_check" CHECK ("record_object" IS NULL OR ((
  jsonb_typeof("record_object") = 'object'
  AND "record_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("record_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "record_object"->>'storage' = 'private-payload-v1'
  AND "record_object"->>'codec' = 'json-gzip'
  AND "record_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "record_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "record_object"->>'key' = 'payloads/v1/json-gzip/' || ("record_object"->>'sha256')
  AND jsonb_typeof("record_object"->'byteLength') = 'number' AND ("record_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("record_object"->'storedByteLength') = 'number' AND ("record_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));

--> statement-breakpoint
DROP FUNCTION storage_payload_cutover_reference(text,text,jsonb,bytea);
