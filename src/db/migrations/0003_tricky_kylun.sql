CREATE TABLE `video_progress` (
	`video_id` text PRIMARY KEY NOT NULL,
	`position_seconds` integer NOT NULL,
	`duration_seconds` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "video_progress_position_non_negative" CHECK("video_progress"."position_seconds" >= 0),
	CONSTRAINT "video_progress_duration_positive" CHECK("video_progress"."duration_seconds" > 0)
);
--> statement-breakpoint
CREATE INDEX `video_progress_updated_at_idx` ON `video_progress` (`updated_at`);