CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`script` text NOT NULL,
	`audio_file_key` text,
	`duration_seconds` integer,
	`status` text DEFAULT 'generating' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `generation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_content` text NOT NULL,
	`source_metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
