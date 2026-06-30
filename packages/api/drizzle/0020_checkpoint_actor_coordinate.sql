ALTER TABLE "game_checkpoints"
  ADD COLUMN "actor_coordinate" text DEFAULT 'none' NOT NULL;

ALTER TABLE "game_checkpoints"
  DROP CONSTRAINT "game_checkpoints_boundary_unique";

ALTER TABLE "game_checkpoints"
  ADD CONSTRAINT "game_checkpoints_boundary_unique"
  UNIQUE ("game_id", "last_event_sequence", "checkpoint_kind", "actor_coordinate");
