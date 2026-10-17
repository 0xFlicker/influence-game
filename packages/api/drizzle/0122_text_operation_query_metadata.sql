-- Keep attempt accounting queryable without reading response documents into SQL.
ALTER TABLE storage_payload_migration_receipts ADD COLUMN IF NOT EXISTS query_metadata jsonb;
--> statement-breakpoint
LOCK TABLE account_text_operations, storage_payload_migration_receipts IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
CREATE FUNCTION storage_text_failure_metadata(operation_id text, reference jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE metadata jsonb;
BEGIN
 IF reference IS NULL THEN RETURN false; END IF;
 IF current_setting('influence.storage_cutover', true) IS DISTINCT FROM 'writers-stopped'
 THEN RAISE EXCEPTION 'Text operation query metadata requires the coordinated storage cutover'; END IF;
 SELECT query_metadata INTO metadata FROM storage_payload_migration_receipts
 WHERE source_table='account_text_operations' AND source_column='result'
   AND row_key=jsonb_build_object('id',operation_id) AND source_sha256=reference->>'sha256';
 IF metadata IS NULL OR jsonb_typeof(metadata->'failedBeforeDispatch') IS DISTINCT FROM 'boolean'
 THEN RAISE EXCEPTION 'Missing verified text operation query metadata (%)',operation_id; END IF;
 RETURN (metadata->>'failedBeforeDispatch')::boolean;
END $$;
--> statement-breakpoint
ALTER TABLE account_text_operations ADD COLUMN failed_before_dispatch boolean GENERATED ALWAYS AS (storage_text_failure_metadata(id,result_object)) STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE account_text_operations ALTER COLUMN failed_before_dispatch DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE account_text_operations ALTER COLUMN failed_before_dispatch SET DEFAULT false;
--> statement-breakpoint
DROP FUNCTION storage_text_failure_metadata(text,jsonb);
