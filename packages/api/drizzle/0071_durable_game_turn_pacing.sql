ALTER TABLE "game_execution_states" ADD COLUMN "last_presentation_phase" text;
--> statement-breakpoint
ALTER TABLE "game_execution_states" ADD COLUMN "next_publication_available_at" text;
--> statement-breakpoint
ALTER TABLE "game_execution_states" DROP CONSTRAINT "game_execution_states_status_check";
--> statement-breakpoint
ALTER TABLE "game_execution_states" ADD CONSTRAINT "game_execution_states_status_check" CHECK ("game_execution_states"."status" IN ('ready', 'waiting_retry', 'terminal', 'repair_required'));
