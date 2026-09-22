ALTER TABLE "visual_render_operations" ALTER COLUMN "game_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "visual_render_operations" ADD COLUMN "user_id" text REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "visual_render_operations" ADD CONSTRAINT "visual_render_operations_owner_check" CHECK ((game_id IS NOT NULL) <> (user_id IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX "visual_render_operations_user_key_unique" ON "visual_render_operations" ("user_id", "operation_key");
