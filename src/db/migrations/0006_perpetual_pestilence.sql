PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_history` (
	`owner` text DEFAULT 'local' NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`channel_title` text NOT NULL,
	`thumbnail_url` text NOT NULL,
	`duration_seconds` integer,
	`last_viewed_at` integer NOT NULL,
	`view_count` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`owner`, `video_id`),
	CONSTRAINT "history_view_count_non_negative" CHECK("__new_history"."view_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_history`("owner", "video_id", "title", "channel_title", "thumbnail_url", "duration_seconds", "last_viewed_at", "view_count") SELECT 'local', "video_id", "title", "channel_title", "thumbnail_url", "duration_seconds", "last_viewed_at", "view_count" FROM `history`;--> statement-breakpoint
DROP TABLE `history`;--> statement-breakpoint
ALTER TABLE `__new_history` RENAME TO `history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `history_owner_last_viewed_at_idx` ON `history` (`owner`,`last_viewed_at`);