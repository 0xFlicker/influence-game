ALTER TABLE "users" ADD COLUMN "rating" integer DEFAULT 1200 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "games_played" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "games_won" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "peak_rating" integer DEFAULT 1200 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_game_at" text;--> statement-breakpoint

-- Migrate existing per-agent ELO to account level:
-- For each user, take the highest-rated agent's stats
UPDATE "users" u
SET
  "rating" = sub.rating,
  "games_played" = sub.games_played,
  "games_won" = sub.games_won,
  "peak_rating" = sub.peak_rating,
  "last_game_at" = sub.last_game_at
FROM (
  SELECT DISTINCT ON (ftr.user_id)
    ftr.user_id,
    ftr.rating,
    ftr.games_played,
    ftr.games_won,
    ftr.peak_rating,
    ftr.last_game_at
  FROM "free_track_ratings" ftr
  WHERE ftr.user_id IS NOT NULL
  ORDER BY ftr.user_id, ftr.rating DESC
) sub
WHERE u.id = sub.user_id;
