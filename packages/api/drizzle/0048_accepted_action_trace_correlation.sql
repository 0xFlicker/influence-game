ALTER TABLE "game_evidence_manifests" ADD COLUMN "decision_id" text;--> statement-breakpoint
CREATE INDEX "game_evidence_manifests_game_owner_decision_id_idx" ON "game_evidence_manifests" USING btree ("game_id","owner_epoch","decision_id");
