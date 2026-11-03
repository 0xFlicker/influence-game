CREATE TABLE championship_match_attempts (
  game_id text PRIMARY KEY REFERENCES games(id),
  match_id text NOT NULL REFERENCES championship_matches(id),
  seat_prefix text NOT NULL
);
--> statement-breakpoint
CREATE INDEX championship_attempt_match ON championship_match_attempts(match_id);
--> statement-breakpoint
INSERT INTO championship_match_attempts(game_id, match_id, seat_prefix)
SELECT game_id, id, id FROM championship_matches WHERE game_id IS NOT NULL;
