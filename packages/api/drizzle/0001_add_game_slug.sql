ALTER TABLE `games` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `games_slug_unique` ON `games` (`slug`);
