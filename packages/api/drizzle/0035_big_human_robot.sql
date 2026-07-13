UPDATE "game_watch_state_summaries" AS "summary"
SET "slug" = "games"."slug"
FROM "games"
WHERE "summary"."game_id" = "games"."id" AND "summary"."slug" IS NULL;--> statement-breakpoint
ALTER TABLE "game_watch_state_summaries" ALTER COLUMN "slug" SET NOT NULL;
