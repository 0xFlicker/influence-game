CREATE TABLE `agent_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`round` integer NOT NULL,
	`memory_type` text NOT NULL,
	`subject` text,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
