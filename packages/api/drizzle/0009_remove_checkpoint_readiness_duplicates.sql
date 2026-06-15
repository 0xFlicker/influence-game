-- One-way checkpoint cleanup: old code that reads/writes these duplicate
-- readiness columns is not rollback-compatible after this migration.
-- Rollback requires restoring the columns from backup or a forward fix.
ALTER TABLE "game_checkpoints" DROP COLUMN "hydrateable";
--> statement-breakpoint
ALTER TABLE "game_checkpoints" DROP COLUMN "degraded_reason";
