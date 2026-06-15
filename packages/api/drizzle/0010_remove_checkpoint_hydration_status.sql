-- One-way checkpoint cleanup: old code that reads/writes hydration_status is
-- not rollback-compatible after this migration. Rollback requires restoring
-- the column from backup or a forward fix.
ALTER TABLE "game_checkpoints" DROP COLUMN "hydration_status";
