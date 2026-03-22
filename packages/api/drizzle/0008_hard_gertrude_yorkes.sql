CREATE TABLE `free_game_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`joined_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `free_game_queue_user_id_unique` ON `free_game_queue` (`user_id`);--> statement-breakpoint
CREATE TABLE `free_track_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_profile_id` text NOT NULL,
	`user_id` text,
	`rating` integer DEFAULT 1200 NOT NULL,
	`games_played` integer DEFAULT 0 NOT NULL,
	`games_won` integer DEFAULT 0 NOT NULL,
	`peak_rating` integer DEFAULT 1200 NOT NULL,
	`last_game_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `free_track_ratings_agent_profile_id_unique` ON `free_track_ratings` (`agent_profile_id`);--> statement-breakpoint
ALTER TABLE `games` ADD `track_type` text DEFAULT 'custom' NOT NULL;