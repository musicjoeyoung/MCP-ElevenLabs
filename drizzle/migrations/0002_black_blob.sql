CREATE TABLE `generation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_content` text NOT NULL,
	`source_metadata` text,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
