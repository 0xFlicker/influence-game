DROP INDEX "agent_learning_game_evidence_identity_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_game_evidence_identity_unique" ON "agent_learning_game_evidence" USING btree ("owner_user_id","agent_profile_id","analytical_revision_id","game_id","evidence_version","source_capture_version","source_hash");
