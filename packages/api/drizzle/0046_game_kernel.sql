-- Durable match spine / mode identity for dual MCP reader shapes.
-- Nullable: unstamped history is resolved on read via format.* event evidence.
-- Do not backfill historical rows to classic (would break format-kernel inference).

ALTER TABLE "games" ADD COLUMN "game_kernel" text;
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_game_kernel_check" CHECK ("game_kernel" IS NULL OR "game_kernel" IN ('classic', 'format'));
