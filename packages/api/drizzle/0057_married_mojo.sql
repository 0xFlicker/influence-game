ALTER TABLE "game_cognitive_artifacts" ADD COLUMN "index_insert_xid" text;--> statement-breakpoint
ALTER TABLE "game_cognitive_artifacts" ALTER COLUMN "index_insert_xid" SET DEFAULT pg_current_xact_id()::text;--> statement-breakpoint
ALTER TABLE "game_evidence_manifests" ADD COLUMN "index_insert_xid" text;--> statement-breakpoint
ALTER TABLE "game_evidence_manifests" ALTER COLUMN "index_insert_xid" SET DEFAULT pg_current_xact_id()::text;
