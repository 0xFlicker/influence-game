ALTER TABLE "game_cognitive_artifacts"
	DROP CONSTRAINT "game_cognitive_artifacts_round_check";

ALTER TABLE "game_cognitive_artifacts"
	ADD CONSTRAINT "game_cognitive_artifacts_round_check"
	CHECK ("round" IS NULL OR "round" >= 0);
