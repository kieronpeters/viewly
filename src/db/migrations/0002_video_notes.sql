CREATE TABLE `video_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `video_notes_video_id_created_at_idx` ON `video_notes` (`video_id`,`created_at`);