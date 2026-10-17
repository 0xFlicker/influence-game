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
LOCK TABLE "agent_content_assets","agent_content_revisions","agent_learning_game_evidence","agent_learning_review_calls","agent_learning_review_failure_evidence_outbox","agent_learning_reviews","game_checkpoints","game_cognitive_artifacts","game_postgame_media","game_retrospective_inputs","game_turns","house_cut_jobs","provider_attempt_evidence_outbox","provider_logical_calls","visual_artifacts","visual_operation_events","visual_render_attempts","visual_render_operations","visual_repair_jobs","visual_room_library" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE game_retrospective_inputs DROP CONSTRAINT game_retrospective_inputs_shape_check;
--> statement-breakpoint
ALTER TABLE "game_retrospective_inputs" ALTER COLUMN "input" TYPE jsonb USING storage_payload_cutover_reference('game_retrospective_inputs','input',jsonb_build_object('game_id',"game_id"),convert_to("input"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "game_retrospective_inputs" RENAME COLUMN "input" TO "input_object";
--> statement-breakpoint
ALTER TABLE "game_retrospective_inputs" ADD CONSTRAINT "payload_2f6306c7abee_check" CHECK ("input_object" IS NULL OR ((
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
ALTER TABLE "game_checkpoints" ALTER COLUMN "snapshot" TYPE jsonb USING storage_payload_cutover_reference('game_checkpoints','snapshot',jsonb_build_object('id',"id"),convert_to("snapshot"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "game_checkpoints" RENAME COLUMN "snapshot" TO "snapshot_object";
--> statement-breakpoint
ALTER TABLE "game_checkpoints" ADD CONSTRAINT "payload_4957bf5f56d9_check" CHECK ("snapshot_object" IS NULL OR ((
  jsonb_typeof("snapshot_object") = 'object'
  AND "snapshot_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("snapshot_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "snapshot_object"->>'storage' = 'private-payload-v1'
  AND "snapshot_object"->>'codec' = 'json-gzip'
  AND "snapshot_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "snapshot_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "snapshot_object"->>'key' = 'payloads/v1/json-gzip/' || ("snapshot_object"->>'sha256')
  AND jsonb_typeof("snapshot_object"->'byteLength') = 'number' AND ("snapshot_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("snapshot_object"->'storedByteLength') = 'number' AND ("snapshot_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" ALTER COLUMN "body" TYPE jsonb USING storage_payload_cutover_reference('provider_attempt_evidence_outbox','body',jsonb_build_object('attempt_id',"attempt_id"),convert_to("body"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" RENAME COLUMN "body" TO "body_object";
--> statement-breakpoint
ALTER TABLE "provider_attempt_evidence_outbox" ADD CONSTRAINT "payload_27471ffbb751_check" CHECK ("body_object" IS NULL OR ((
  jsonb_typeof("body_object") = 'object'
  AND "body_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("body_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "body_object"->>'storage' = 'private-payload-v1'
  AND "body_object"->>'codec' = 'text-gzip'
  AND "body_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "body_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "body_object"->>'key' = 'payloads/v1/text-gzip/' || ("body_object"->>'sha256')
  AND jsonb_typeof("body_object"->'byteLength') = 'number' AND ("body_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("body_object"->'storedByteLength') = 'number' AND ("body_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "game_postgame_media" ALTER COLUMN "render_input_snapshot" TYPE jsonb USING storage_payload_cutover_reference('game_postgame_media','render_input_snapshot',jsonb_build_object('game_id',"game_id",'media_type',"media_type"),convert_to("render_input_snapshot"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "game_postgame_media" RENAME COLUMN "render_input_snapshot" TO "render_input_snapshot_object";
--> statement-breakpoint
ALTER TABLE "game_postgame_media" ADD CONSTRAINT "payload_dfefb5bd369f_check" CHECK ("render_input_snapshot_object" IS NULL OR ((
  jsonb_typeof("render_input_snapshot_object") = 'object'
  AND "render_input_snapshot_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("render_input_snapshot_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "render_input_snapshot_object"->>'storage' = 'private-payload-v1'
  AND "render_input_snapshot_object"->>'codec' = 'json-gzip'
  AND "render_input_snapshot_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "render_input_snapshot_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "render_input_snapshot_object"->>'key' = 'payloads/v1/json-gzip/' || ("render_input_snapshot_object"->>'sha256')
  AND jsonb_typeof("render_input_snapshot_object"->'byteLength') = 'number' AND ("render_input_snapshot_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("render_input_snapshot_object"->'storedByteLength') = 'number' AND ("render_input_snapshot_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "game_cognitive_artifacts" ALTER COLUMN "payload" TYPE jsonb USING storage_payload_cutover_reference('game_cognitive_artifacts','payload',jsonb_build_object('id',"id"),convert_to("payload"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "game_cognitive_artifacts" RENAME COLUMN "payload" TO "payload_object";
--> statement-breakpoint
ALTER TABLE "game_cognitive_artifacts" ADD CONSTRAINT "payload_08aa98fdb5a4_check" CHECK ("payload_object" IS NULL OR ((
  jsonb_typeof("payload_object") = 'object'
  AND "payload_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("payload_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "payload_object"->>'storage' = 'private-payload-v1'
  AND "payload_object"->>'codec' = 'json-gzip'
  AND "payload_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "payload_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "payload_object"->>'key' = 'payloads/v1/json-gzip/' || ("payload_object"->>'sha256')
  AND jsonb_typeof("payload_object"->'byteLength') = 'number' AND ("payload_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("payload_object"->'storedByteLength') = 'number' AND ("payload_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" ALTER COLUMN "canonical_snapshot" TYPE jsonb USING storage_payload_cutover_reference('agent_learning_game_evidence','canonical_snapshot',jsonb_build_object('id',"id"),convert_to("canonical_snapshot"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" RENAME COLUMN "canonical_snapshot" TO "canonical_snapshot_object";
--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" ADD CONSTRAINT "payload_bd79a9e2c8c7_check" CHECK ("canonical_snapshot_object" IS NULL OR ((
  jsonb_typeof("canonical_snapshot_object") = 'object'
  AND "canonical_snapshot_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("canonical_snapshot_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "canonical_snapshot_object"->>'storage' = 'private-payload-v1'
  AND "canonical_snapshot_object"->>'codec' = 'json-gzip'
  AND "canonical_snapshot_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "canonical_snapshot_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "canonical_snapshot_object"->>'key' = 'payloads/v1/json-gzip/' || ("canonical_snapshot_object"->>'sha256')
  AND jsonb_typeof("canonical_snapshot_object"->'byteLength') = 'number' AND ("canonical_snapshot_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("canonical_snapshot_object"->'storedByteLength') = 'number' AND ("canonical_snapshot_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" ALTER COLUMN "candidate_moments" TYPE jsonb USING storage_payload_cutover_reference('agent_learning_game_evidence','candidate_moments',jsonb_build_object('id',"id"),convert_to("candidate_moments"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" RENAME COLUMN "candidate_moments" TO "candidate_moments_object";
--> statement-breakpoint
ALTER TABLE "agent_learning_game_evidence" ADD CONSTRAINT "payload_2f846c39a99c_check" CHECK ("candidate_moments_object" IS NULL OR ((
  jsonb_typeof("candidate_moments_object") = 'object'
  AND "candidate_moments_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("candidate_moments_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "candidate_moments_object"->>'storage' = 'private-payload-v1'
  AND "candidate_moments_object"->>'codec' = 'json-gzip'
  AND "candidate_moments_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "candidate_moments_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "candidate_moments_object"->>'key' = 'payloads/v1/json-gzip/' || ("candidate_moments_object"->>'sha256')
  AND jsonb_typeof("candidate_moments_object"->'byteLength') = 'number' AND ("candidate_moments_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("candidate_moments_object"->'storedByteLength') = 'number' AND ("candidate_moments_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ALTER COLUMN "checkpoint" TYPE jsonb USING storage_payload_cutover_reference('agent_learning_reviews','checkpoint',jsonb_build_object('id',"id"),convert_to("checkpoint"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" RENAME COLUMN "checkpoint" TO "checkpoint_object";
--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "payload_1b019e75854a_check" CHECK ("checkpoint_object" IS NULL OR ((
  jsonb_typeof("checkpoint_object") = 'object'
  AND "checkpoint_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("checkpoint_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "checkpoint_object"->>'storage' = 'private-payload-v1'
  AND "checkpoint_object"->>'codec' = 'json-gzip'
  AND "checkpoint_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "checkpoint_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "checkpoint_object"->>'key' = 'payloads/v1/json-gzip/' || ("checkpoint_object"->>'sha256')
  AND jsonb_typeof("checkpoint_object"->'byteLength') = 'number' AND ("checkpoint_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("checkpoint_object"->'storedByteLength') = 'number' AND ("checkpoint_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ALTER COLUMN "result" TYPE jsonb USING storage_payload_cutover_reference('agent_learning_reviews','result',jsonb_build_object('id',"id"),convert_to("result"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" RENAME COLUMN "result" TO "result_object";
--> statement-breakpoint
ALTER TABLE "agent_learning_reviews" ADD CONSTRAINT "payload_b41dadefbbe9_check" CHECK ("result_object" IS NULL OR ((
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
ALTER TABLE "agent_learning_review_calls" ALTER COLUMN "validated_checkpoint" TYPE jsonb USING storage_payload_cutover_reference('agent_learning_review_calls','validated_checkpoint',jsonb_build_object('id',"id"),convert_to("validated_checkpoint"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" RENAME COLUMN "validated_checkpoint" TO "validated_checkpoint_object";
--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "payload_31542f565632_check" CHECK ("validated_checkpoint_object" IS NULL OR ((
  jsonb_typeof("validated_checkpoint_object") = 'object'
  AND "validated_checkpoint_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("validated_checkpoint_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "validated_checkpoint_object"->>'storage' = 'private-payload-v1'
  AND "validated_checkpoint_object"->>'codec' = 'json-gzip'
  AND "validated_checkpoint_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "validated_checkpoint_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "validated_checkpoint_object"->>'key' = 'payloads/v1/json-gzip/' || ("validated_checkpoint_object"->>'sha256')
  AND jsonb_typeof("validated_checkpoint_object"->'byteLength') = 'number' AND ("validated_checkpoint_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("validated_checkpoint_object"->'storedByteLength') = 'number' AND ("validated_checkpoint_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ALTER COLUMN "request_evidence_body" TYPE jsonb USING storage_payload_cutover_reference('agent_learning_review_calls','request_evidence_body',jsonb_build_object('id',"id"),convert_to("request_evidence_body"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" RENAME COLUMN "request_evidence_body" TO "request_evidence_body_object";
--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "payload_51f0c19a7cef_check" CHECK ("request_evidence_body_object" IS NULL OR ((
  jsonb_typeof("request_evidence_body_object") = 'object'
  AND "request_evidence_body_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("request_evidence_body_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "request_evidence_body_object"->>'storage' = 'private-payload-v1'
  AND "request_evidence_body_object"->>'codec' = 'text-gzip'
  AND "request_evidence_body_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "request_evidence_body_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "request_evidence_body_object"->>'key' = 'payloads/v1/text-gzip/' || ("request_evidence_body_object"->>'sha256')
  AND jsonb_typeof("request_evidence_body_object"->'byteLength') = 'number' AND ("request_evidence_body_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("request_evidence_body_object"->'storedByteLength') = 'number' AND ("request_evidence_body_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ALTER COLUMN "response_evidence_body" TYPE jsonb USING storage_payload_cutover_reference('agent_learning_review_calls','response_evidence_body',jsonb_build_object('id',"id"),convert_to("response_evidence_body"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" RENAME COLUMN "response_evidence_body" TO "response_evidence_body_object";
--> statement-breakpoint
ALTER TABLE "agent_learning_review_calls" ADD CONSTRAINT "payload_074a40574742_check" CHECK ("response_evidence_body_object" IS NULL OR ((
  jsonb_typeof("response_evidence_body_object") = 'object'
  AND "response_evidence_body_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("response_evidence_body_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "response_evidence_body_object"->>'storage' = 'private-payload-v1'
  AND "response_evidence_body_object"->>'codec' = 'text-gzip'
  AND "response_evidence_body_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "response_evidence_body_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "response_evidence_body_object"->>'key' = 'payloads/v1/text-gzip/' || ("response_evidence_body_object"->>'sha256')
  AND jsonb_typeof("response_evidence_body_object"->'byteLength') = 'number' AND ("response_evidence_body_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("response_evidence_body_object"->'storedByteLength') = 'number' AND ("response_evidence_body_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_evidence_outbox" ALTER COLUMN "body" TYPE jsonb USING storage_payload_cutover_reference('agent_learning_review_failure_evidence_outbox','body',jsonb_build_object('diagnostic_id',"diagnostic_id"),convert_to("body"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_evidence_outbox" RENAME COLUMN "body" TO "body_object";
--> statement-breakpoint
ALTER TABLE "agent_learning_review_failure_evidence_outbox" ADD CONSTRAINT "payload_96fc611e37a4_check" CHECK ("body_object" IS NULL OR ((
  jsonb_typeof("body_object") = 'object'
  AND "body_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("body_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "body_object"->>'storage' = 'private-payload-v1'
  AND "body_object"->>'codec' = 'text-gzip'
  AND "body_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "body_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "body_object"->>'key' = 'payloads/v1/text-gzip/' || ("body_object"->>'sha256')
  AND jsonb_typeof("body_object"->'byteLength') = 'number' AND ("body_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("body_object"->'storedByteLength') = 'number' AND ("body_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "visual_operation_events" ALTER COLUMN "evidence" TYPE jsonb USING storage_payload_cutover_reference('visual_operation_events','evidence',jsonb_build_object('id',"id"),convert_to("evidence"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "visual_operation_events" RENAME COLUMN "evidence" TO "evidence_object";
--> statement-breakpoint
ALTER TABLE "visual_operation_events" ADD CONSTRAINT "payload_f4e40ba76f1f_check" CHECK ("evidence_object" IS NULL OR ((
  jsonb_typeof("evidence_object") = 'object'
  AND "evidence_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("evidence_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "evidence_object"->>'storage' = 'private-payload-v1'
  AND "evidence_object"->>'codec' = 'json-gzip'
  AND "evidence_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "evidence_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "evidence_object"->>'key' = 'payloads/v1/json-gzip/' || ("evidence_object"->>'sha256')
  AND jsonb_typeof("evidence_object"->'byteLength') = 'number' AND ("evidence_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("evidence_object"->'storedByteLength') = 'number' AND ("evidence_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "visual_render_operations" ALTER COLUMN "request" TYPE jsonb USING storage_payload_cutover_reference('visual_render_operations','request',jsonb_build_object('id',"id"),convert_to("request"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "visual_render_operations" RENAME COLUMN "request" TO "request_object";
--> statement-breakpoint
ALTER TABLE "visual_render_operations" ADD CONSTRAINT "payload_3009bca4f82d_check" CHECK ("request_object" IS NULL OR ((
  jsonb_typeof("request_object") = 'object'
  AND "request_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("request_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "request_object"->>'storage' = 'private-payload-v1'
  AND "request_object"->>'codec' = 'json-gzip'
  AND "request_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "request_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "request_object"->>'key' = 'payloads/v1/json-gzip/' || ("request_object"->>'sha256')
  AND jsonb_typeof("request_object"->'byteLength') = 'number' AND ("request_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("request_object"->'storedByteLength') = 'number' AND ("request_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "visual_render_attempts" ALTER COLUMN "image" TYPE jsonb USING storage_payload_cutover_reference('visual_render_attempts','image',jsonb_build_object('id',"id"),"image");
--> statement-breakpoint
ALTER TABLE "visual_render_attempts" RENAME COLUMN "image" TO "image_object";
--> statement-breakpoint
ALTER TABLE "visual_render_attempts" ADD CONSTRAINT "payload_858678e946fc_check" CHECK ("image_object" IS NULL OR ((
  jsonb_typeof("image_object") = 'object'
  AND "image_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("image_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "image_object"->>'storage' = 'private-payload-v1'
  AND "image_object"->>'codec' = 'binary'
  AND "image_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "image_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "image_object"->>'key' = 'payloads/v1/binary/' || ("image_object"->>'sha256')
  AND jsonb_typeof("image_object"->'byteLength') = 'number' AND ("image_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("image_object"->'storedByteLength') = 'number' AND ("image_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "visual_artifacts" ALTER COLUMN "image" TYPE jsonb USING storage_payload_cutover_reference('visual_artifacts','image',jsonb_build_object('id',"id"),"image");
--> statement-breakpoint
ALTER TABLE "visual_artifacts" RENAME COLUMN "image" TO "image_object";
--> statement-breakpoint
ALTER TABLE "visual_artifacts" ADD CONSTRAINT "payload_ab85b88f496b_check" CHECK ("image_object" IS NULL OR ((
  jsonb_typeof("image_object") = 'object'
  AND "image_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("image_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "image_object"->>'storage' = 'private-payload-v1'
  AND "image_object"->>'codec' = 'binary'
  AND "image_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "image_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "image_object"->>'key' = 'payloads/v1/binary/' || ("image_object"->>'sha256')
  AND jsonb_typeof("image_object"->'byteLength') = 'number' AND ("image_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("image_object"->'storedByteLength') = 'number' AND ("image_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "visual_room_library" ALTER COLUMN "image" TYPE jsonb USING storage_payload_cutover_reference('visual_room_library','image',jsonb_build_object('room_id',"room_id",'version',"version"),"image");
--> statement-breakpoint
ALTER TABLE "visual_room_library" RENAME COLUMN "image" TO "image_object";
--> statement-breakpoint
ALTER TABLE "visual_room_library" ADD CONSTRAINT "payload_727765fe6cd5_check" CHECK ("image_object" IS NULL OR ((
  jsonb_typeof("image_object") = 'object'
  AND "image_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("image_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "image_object"->>'storage' = 'private-payload-v1'
  AND "image_object"->>'codec' = 'binary'
  AND "image_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "image_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "image_object"->>'key' = 'payloads/v1/binary/' || ("image_object"->>'sha256')
  AND jsonb_typeof("image_object"->'byteLength') = 'number' AND ("image_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("image_object"->'storedByteLength') = 'number' AND ("image_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_content_revisions" ALTER COLUMN "snapshot" TYPE jsonb USING storage_payload_cutover_reference('agent_content_revisions','snapshot',jsonb_build_object('id',"id"),convert_to("snapshot"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "agent_content_revisions" RENAME COLUMN "snapshot" TO "snapshot_object";
--> statement-breakpoint
ALTER TABLE "agent_content_revisions" ADD CONSTRAINT "payload_9d821fcccc38_check" CHECK ("snapshot_object" IS NULL OR ((
  jsonb_typeof("snapshot_object") = 'object'
  AND "snapshot_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("snapshot_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "snapshot_object"->>'storage' = 'private-payload-v1'
  AND "snapshot_object"->>'codec' = 'json-gzip'
  AND "snapshot_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "snapshot_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "snapshot_object"->>'key' = 'payloads/v1/json-gzip/' || ("snapshot_object"->>'sha256')
  AND jsonb_typeof("snapshot_object"->'byteLength') = 'number' AND ("snapshot_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("snapshot_object"->'storedByteLength') = 'number' AND ("snapshot_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "agent_content_assets" ALTER COLUMN "bytes" TYPE jsonb USING storage_payload_cutover_reference('agent_content_assets','bytes',jsonb_build_object('hash',"hash"),"bytes");
--> statement-breakpoint
ALTER TABLE "agent_content_assets" RENAME COLUMN "bytes" TO "bytes_object";
--> statement-breakpoint
ALTER TABLE "agent_content_assets" ADD CONSTRAINT "payload_1389d81abbfc_check" CHECK ("bytes_object" IS NULL OR ((
  jsonb_typeof("bytes_object") = 'object'
  AND "bytes_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("bytes_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "bytes_object"->>'storage' = 'private-payload-v1'
  AND "bytes_object"->>'codec' = 'binary'
  AND "bytes_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "bytes_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "bytes_object"->>'key' = 'payloads/v1/binary/' || ("bytes_object"->>'sha256')
  AND jsonb_typeof("bytes_object"->'byteLength') = 'number' AND ("bytes_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("bytes_object"->'storedByteLength') = 'number' AND ("bytes_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "visual_repair_jobs" ALTER COLUMN "render_context" TYPE jsonb USING storage_payload_cutover_reference('visual_repair_jobs','render_context',jsonb_build_object('id',"id"),convert_to("render_context"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "visual_repair_jobs" RENAME COLUMN "render_context" TO "render_context_object";
--> statement-breakpoint
ALTER TABLE "visual_repair_jobs" ADD CONSTRAINT "payload_94ffdc4c8f80_check" CHECK ("render_context_object" IS NULL OR ((
  jsonb_typeof("render_context_object") = 'object'
  AND "render_context_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("render_context_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "render_context_object"->>'storage' = 'private-payload-v1'
  AND "render_context_object"->>'codec' = 'json-gzip'
  AND "render_context_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "render_context_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "render_context_object"->>'key' = 'payloads/v1/json-gzip/' || ("render_context_object"->>'sha256')
  AND jsonb_typeof("render_context_object"->'byteLength') = 'number' AND ("render_context_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("render_context_object"->'storedByteLength') = 'number' AND ("render_context_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "house_cut_jobs" ALTER COLUMN "source" TYPE jsonb USING storage_payload_cutover_reference('house_cut_jobs','source',jsonb_build_object('id',"id"),convert_to("source"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "house_cut_jobs" RENAME COLUMN "source" TO "source_object";
--> statement-breakpoint
ALTER TABLE "house_cut_jobs" ADD CONSTRAINT "payload_34529c7ddf78_check" CHECK ("source_object" IS NULL OR ((
  jsonb_typeof("source_object") = 'object'
  AND "source_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("source_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "source_object"->>'storage' = 'private-payload-v1'
  AND "source_object"->>'codec' = 'json-gzip'
  AND "source_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "source_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "source_object"->>'key' = 'payloads/v1/json-gzip/' || ("source_object"->>'sha256')
  AND jsonb_typeof("source_object"->'byteLength') = 'number' AND ("source_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("source_object"->'storedByteLength') = 'number' AND ("source_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "house_cut_jobs" ALTER COLUMN "journal" TYPE jsonb USING storage_payload_cutover_reference('house_cut_jobs','journal',jsonb_build_object('id',"id"),convert_to("journal"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "house_cut_jobs" RENAME COLUMN "journal" TO "journal_object";
--> statement-breakpoint
ALTER TABLE "house_cut_jobs" ADD CONSTRAINT "payload_394d94f5e256_check" CHECK ("journal_object" IS NULL OR ((
  jsonb_typeof("journal_object") = 'object'
  AND "journal_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("journal_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "journal_object"->>'storage' = 'private-payload-v1'
  AND "journal_object"->>'codec' = 'json-gzip'
  AND "journal_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "journal_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "journal_object"->>'key' = 'payloads/v1/json-gzip/' || ("journal_object"->>'sha256')
  AND jsonb_typeof("journal_object"->'byteLength') = 'number' AND ("journal_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("journal_object"->'storedByteLength') = 'number' AND ("journal_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "house_cut_jobs" ALTER COLUMN "publication" TYPE jsonb USING storage_payload_cutover_reference('house_cut_jobs','publication',jsonb_build_object('id',"id"),convert_to("publication"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "house_cut_jobs" RENAME COLUMN "publication" TO "publication_object";
--> statement-breakpoint
ALTER TABLE "house_cut_jobs" ADD CONSTRAINT "payload_b824c774bf73_check" CHECK ("publication_object" IS NULL OR ((
  jsonb_typeof("publication_object") = 'object'
  AND "publication_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("publication_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "publication_object"->>'storage' = 'private-payload-v1'
  AND "publication_object"->>'codec' = 'json-gzip'
  AND "publication_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "publication_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "publication_object"->>'key' = 'payloads/v1/json-gzip/' || ("publication_object"->>'sha256')
  AND jsonb_typeof("publication_object"->'byteLength') = 'number' AND ("publication_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("publication_object"->'storedByteLength') = 'number' AND ("publication_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "game_turns" ALTER COLUMN "intent" TYPE jsonb USING storage_payload_cutover_reference('game_turns','intent',jsonb_build_object('id',"id"),convert_to("intent"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "game_turns" RENAME COLUMN "intent" TO "intent_object";
--> statement-breakpoint
ALTER TABLE "game_turns" ADD CONSTRAINT "payload_34794af8e952_check" CHECK ("intent_object" IS NULL OR ((
  jsonb_typeof("intent_object") = 'object'
  AND "intent_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("intent_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "intent_object"->>'storage' = 'private-payload-v1'
  AND "intent_object"->>'codec' = 'json-gzip'
  AND "intent_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "intent_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "intent_object"->>'key' = 'payloads/v1/json-gzip/' || ("intent_object"->>'sha256')
  AND jsonb_typeof("intent_object"->'byteLength') = 'number' AND ("intent_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("intent_object"->'storedByteLength') = 'number' AND ("intent_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "game_turns" ALTER COLUMN "commit_result" TYPE jsonb USING storage_payload_cutover_reference('game_turns','commit_result',jsonb_build_object('id',"id"),convert_to("commit_result"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "game_turns" RENAME COLUMN "commit_result" TO "commit_result_object";
--> statement-breakpoint
ALTER TABLE "game_turns" ADD CONSTRAINT "payload_c798e6f79d53_check" CHECK ("commit_result_object" IS NULL OR ((
  jsonb_typeof("commit_result_object") = 'object'
  AND "commit_result_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("commit_result_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "commit_result_object"->>'storage' = 'private-payload-v1'
  AND "commit_result_object"->>'codec' = 'json-gzip'
  AND "commit_result_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "commit_result_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "commit_result_object"->>'key' = 'payloads/v1/json-gzip/' || ("commit_result_object"->>'sha256')
  AND jsonb_typeof("commit_result_object"->'byteLength') = 'number' AND ("commit_result_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("commit_result_object"->'storedByteLength') = 'number' AND ("commit_result_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ALTER COLUMN "accepted_value" TYPE jsonb USING storage_payload_cutover_reference('provider_logical_calls','accepted_value',jsonb_build_object('id',"id"),convert_to("accepted_value"::text,'UTF8'));
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" RENAME COLUMN "accepted_value" TO "accepted_value_object";
--> statement-breakpoint
ALTER TABLE "provider_logical_calls" ADD CONSTRAINT "payload_a38fcee9b293_check" CHECK ("accepted_value_object" IS NULL OR ((
  jsonb_typeof("accepted_value_object") = 'object'
  AND "accepted_value_object" ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
  AND ("accepted_value_object" - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
  AND "accepted_value_object"->>'storage' = 'private-payload-v1'
  AND "accepted_value_object"->>'codec' = 'json-gzip'
  AND "accepted_value_object"->>'sha256' ~ '^[a-f0-9]{64}$'
  AND "accepted_value_object"->>'storedSha256' ~ '^[a-f0-9]{64}$'
  AND "accepted_value_object"->>'key' = 'payloads/v1/json-gzip/' || ("accepted_value_object"->>'sha256')
  AND jsonb_typeof("accepted_value_object"->'byteLength') = 'number' AND ("accepted_value_object"->>'byteLength')::bigint >= 0
  AND jsonb_typeof("accepted_value_object"->'storedByteLength') = 'number' AND ("accepted_value_object"->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION immutable_visual_repair_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.game_id,NEW.scene_id,NEW.version,NEW.operator_id,NEW.mode,NEW.plan,NEW.render_context_object,NEW.source_image_id,NEW.source_version_id,NEW.reuse_prefix,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.game_id,OLD.scene_id,OLD.version,OLD.operator_id,OLD.mode,OLD.plan,OLD.render_context_object,OLD.source_image_id,OLD.source_version_id,OLD.reuse_prefix,OLD.created_at)
 THEN RAISE EXCEPTION 'Visual repair inputs are immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.owner_learning_validate_invalid_structured_output()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  manifest_state text;
  call_receipt record;
BEGIN
  IF NEW.safe_failure_code <> 'invalid_structured_output' THEN
    RETURN NEW;
  END IF;

  SELECT manifest.state INTO manifest_state
  FROM agent_learning_review_failure_manifests manifest
  WHERE manifest.diagnostic_id = NEW.id
    AND manifest.review_id = NEW.review_id;

  IF NEW.error_code = 'legacy_uncaptured' AND manifest_state = 'legacy_unavailable' THEN
    RETURN NEW;
  END IF;

  SELECT
    call.provider_response_observed_at,
    call.provider_response_sha256,
    call.response_evidence_body_object,
    call.response_evidence_body_sha256,
    call.response_evidence_byte_length,
    call.failure_diagnostic_id,
    call.evidence_state
  INTO call_receipt
  FROM agent_learning_review_calls call
  WHERE call.id = NEW.call_id
    AND call.review_id = NEW.review_id;

  IF NEW.phase IS DISTINCT FROM 'output_validation'
    OR NEW.call_id IS NULL
    OR call_receipt.provider_response_observed_at IS NULL
    OR call_receipt.provider_response_sha256 IS NULL
    OR call_receipt.response_evidence_body_object IS NULL
    OR call_receipt.response_evidence_body_sha256 IS NULL
    OR call_receipt.response_evidence_byte_length IS NULL
    OR call_receipt.failure_diagnostic_id IS DISTINCT FROM NEW.id
    OR call_receipt.evidence_state NOT IN ('pending', 'stored', 'degraded')
    OR manifest_state NOT IN ('pending', 'stored', 'degraded')
  THEN
    RAISE EXCEPTION 'invalid_structured_output requires linked byte-complete provider response evidence and a failure manifest';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
DROP FUNCTION storage_payload_cutover_reference(text,text,jsonb,bytea);
