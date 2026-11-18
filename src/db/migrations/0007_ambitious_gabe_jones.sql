PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_favourites` (
	`owner` text DEFAULT 'local' NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`channel_title` text NOT NULL,
	`thumbnail_url` text NOT NULL,
	`duration_seconds` integer,
	`saved_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `video_id`)
);
--> statement-breakpoint
INSERT INTO `__new_favourites`("owner", "video_id", "title", "channel_title", "thumbnail_url", "duration_seconds", "saved_at") SELECT 'local', "video_id", "title", "channel_title", "thumbnail_url", "duration_seconds", "saved_at" FROM `favourites`;--> statement-breakpoint
DROP TABLE `favourites`;--> statement-breakpoint
ALTER TABLE `__new_favourites` RENAME TO `favourites`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `favourites_owner_saved_at_idx` ON `favourites` (`owner`,`saved_at`);--> statement-breakpoint
CREATE TABLE `__new_watch_later` (
	`owner` text DEFAULT 'local' NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`channel_title` text NOT NULL,
	`thumbnail_url` text NOT NULL,
	`duration_seconds` integer,
	`saved_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `video_id`)
);
--> statement-breakpoint
INSERT INTO `__new_watch_later`("owner", "video_id", "title", "channel_title", "thumbnail_url", "duration_seconds", "saved_at") SELECT 'local', "video_id", "title", "channel_title", "thumbnail_url", "duration_seconds", "saved_at" FROM `watch_later`;--> statement-breakpoint
DROP TABLE `watch_later`;--> statement-breakpoint
ALTER TABLE `__new_watch_later` RENAME TO `watch_later`;--> statement-breakpoint
CREATE INDEX `watch_later_owner_saved_at_idx` ON `watch_later` (`owner`,`saved_at`);
