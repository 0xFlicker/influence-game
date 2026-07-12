CREATE TABLE "free_queue_prompt_suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"season_id" text NOT NULL,
	"reason" text NOT NULL,
	"suppressed_until" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "free_queue_prompt_suppressions_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "free_queue_prompt_suppressions_reason_check" CHECK ("free_queue_prompt_suppressions"."reason" IN ('maybe_later', 'left_queue', 'admin_removed'))
);
--> statement-breakpoint
ALTER TABLE "free_game_queue" ADD COLUMN "consecutive_misses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "free_queue_prompt_suppressions" ADD CONSTRAINT "free_queue_prompt_suppressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_queue_prompt_suppressions" ADD CONSTRAINT "free_queue_prompt_suppressions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;