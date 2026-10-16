ALTER TABLE "werewolf_lobby_seats" ALTER COLUMN "agent_profile_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "werewolf_lobby_seats" ADD COLUMN "house_character" jsonb;
--> statement-breakpoint
ALTER TABLE "werewolf_lobby_seats" ADD CONSTRAINT "werewolf_lobby_seat_identity" CHECK (("agent_profile_id" IS NOT NULL) <> ("house_character" IS NOT NULL));
