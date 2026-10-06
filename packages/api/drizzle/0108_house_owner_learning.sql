-- Review identities are game-specific; Influence rating revisions remain unchanged.
ALTER TABLE agent_learning_game_evidence DROP CONSTRAINT "agent_learning_game_evidence_analytical_revision_id_agent_revisions_id_fk";
--> statement-breakpoint
ALTER TABLE agent_learning_reviews DROP CONSTRAINT "agent_learning_reviews_reviewed_revision_id_agent_revisions_id_fk";
--> statement-breakpoint
ALTER TABLE agent_learning_review_applications DROP CONSTRAINT "agent_learning_review_applications_prior_revision_id_agent_revisions_id_fk";
--> statement-breakpoint
ALTER TABLE agent_learning_review_applications DROP CONSTRAINT "agent_learning_review_applications_resulting_revision_id_agent_revisions_id_fk";
--> statement-breakpoint
ALTER TABLE agent_learning_game_evidence ADD COLUMN game_kind text NOT NULL DEFAULT 'influence';
--> statement-breakpoint
ALTER TABLE agent_learning_game_evidence ADD CONSTRAINT agent_learning_game_evidence_game_kind_check CHECK (game_kind IN ('influence', 'werewolf'));
--> statement-breakpoint
ALTER TABLE agent_learning_reviews ADD COLUMN game_kind text NOT NULL DEFAULT 'influence';
--> statement-breakpoint
ALTER TABLE agent_learning_reviews ADD CONSTRAINT agent_learning_reviews_game_kind_check CHECK (game_kind IN ('influence', 'werewolf'));
--> statement-breakpoint
ALTER TABLE agent_learning_reviews ADD COLUMN reviewed_strategy_style text;
--> statement-breakpoint
UPDATE agent_learning_reviews r SET reviewed_strategy_style = a.behavior_snapshot->>'strategyInstructions' FROM agent_revisions a WHERE a.id = r.reviewed_revision_id;
