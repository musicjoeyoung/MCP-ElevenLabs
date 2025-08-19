ALTER TABLE `generation_requests` RENAME TO `episode_hosts`;--> statement-breakpoint
ALTER TABLE `episode_hosts` RENAME COLUMN "source_type" TO "host_id";--> statement-breakpoint
CREATE TABLE `hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`voice_id` text NOT NULL,
	`personality` text NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_episode_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`host_id` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_episode_hosts`("id", "episode_id", "host_id") SELECT "id", "episode_id", "host_id" FROM `episode_hosts`;--> statement-breakpoint
DROP TABLE `episode_hosts`;--> statement-breakpoint
ALTER TABLE `__new_episode_hosts` RENAME TO `episode_hosts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`script` text,
	`audio_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_content` text NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`duration_seconds` integer
);
--> statement-breakpoint
INSERT INTO `__new_episodes`("id", "title", "description", "script", "audio_url", "status", "source_content", "created_at", "updated_at", "duration_seconds") SELECT "id", "title", "description", "script", "audio_url", "status", "source_content", "created_at", "updated_at", "duration_seconds" FROM `episodes`;--> statement-breakpoint
DROP TABLE `episodes`;--> statement-breakpoint
ALTER TABLE `__new_episodes` RENAME TO `episodes`;