DROP TABLE `payments`;--> statement-breakpoint
DROP TABLE `payouts`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_game_players` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text,
	`agent_profile_id` text,
	`persona` text NOT NULL,
	`agent_config` text NOT NULL,
	`joined_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_game_players`("id", "game_id", "user_id", "agent_profile_id", "persona", "agent_config", "joined_at") SELECT "id", "game_id", "user_id", "agent_profile_id", "persona", "agent_config", "joined_at" FROM `game_players`;--> statement-breakpoint
DROP TABLE `game_players`;--> statement-breakpoint
ALTER TABLE `__new_game_players` RENAME TO `game_players`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `tier_id`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `buy_in_amount`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `prize_pool`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `rake_amount`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `payout_status`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `free_entry`;