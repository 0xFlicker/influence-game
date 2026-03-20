ALTER TABLE `games` ADD COLUMN `tier_id` text;
--> statement-breakpoint
ALTER TABLE `games` ADD COLUMN `buy_in_amount` real;
--> statement-breakpoint
ALTER TABLE `games` ADD COLUMN `prize_pool` real DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `games` ADD COLUMN `rake_amount` real DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `games` ADD COLUMN `payout_status` text;
--> statement-breakpoint
ALTER TABLE `games` ADD COLUMN `free_entry` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `game_players` ADD COLUMN `payment_id` text REFERENCES `payments`(`id`);
--> statement-breakpoint
ALTER TABLE `game_players` ADD COLUMN `model_upgrade` integer DEFAULT 0;
