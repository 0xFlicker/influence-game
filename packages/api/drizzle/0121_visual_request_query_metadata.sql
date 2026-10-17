-- Same coordinated cutover transaction as 0119/0120. These are SQL-queryable
-- control fields, not another document copy. Existing immutable requests are preserved.
ALTER TABLE storage_payload_migration_receipts ADD COLUMN IF NOT EXISTS query_metadata jsonb;
--> statement-breakpoint
LOCK TABLE visual_media_requests, storage_payload_migration_receipts IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
-- IMMUTABLE is valid only for this locked materialization. Drop the function
-- and generated expressions before releasing the transaction's table locks.
CREATE FUNCTION storage_visual_request_metadata(request_id text, reference jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE metadata jsonb;
BEGIN
 IF current_setting('influence.storage_cutover', true) IS DISTINCT FROM 'writers-stopped'
 THEN RAISE EXCEPTION 'Visual query metadata requires the coordinated storage cutover'; END IF;
 SELECT query_metadata INTO metadata FROM storage_payload_migration_receipts
 WHERE source_table='visual_media_requests' AND source_column='input'
   AND row_key=jsonb_build_object('id',request_id)
   AND source_sha256=reference->>'sha256';
 IF metadata IS NULL OR jsonb_typeof(metadata) <> 'object'
   OR NOT (metadata ?& ARRAY['sceneId','action','acknowledgedAttemptIds'])
   OR jsonb_typeof(metadata->'acknowledgedAttemptIds') <> 'array'
 THEN RAISE EXCEPTION 'Missing verified visual request query metadata (%)',request_id; END IF;
 RETURN metadata;
END $$;
--> statement-breakpoint
ALTER TABLE visual_media_requests ADD COLUMN scene_id text GENERATED ALWAYS AS (storage_visual_request_metadata(id,input_object)->>'sceneId') STORED;
--> statement-breakpoint
ALTER TABLE visual_media_requests ALTER COLUMN scene_id DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE visual_media_requests ADD COLUMN action text GENERATED ALWAYS AS (storage_visual_request_metadata(id,input_object)->>'action') STORED;
--> statement-breakpoint
ALTER TABLE visual_media_requests ALTER COLUMN action DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE visual_media_requests ADD COLUMN acknowledged_attempt_ids jsonb GENERATED ALWAYS AS (storage_visual_request_metadata(id,input_object)->'acknowledgedAttemptIds') STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE visual_media_requests ALTER COLUMN acknowledged_attempt_ids DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE visual_media_requests ALTER COLUMN acknowledged_attempt_ids SET DEFAULT '[]'::jsonb;
--> statement-breakpoint
DROP FUNCTION storage_visual_request_metadata(text,jsonb);
