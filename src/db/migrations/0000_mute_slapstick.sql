CREATE TABLE `favourites` (
	`video_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`channel_title` text NOT NULL,
	`thumbnail_url` text NOT NULL,
	`duration_seconds` integer,
	`saved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `favourites_saved_at_idx` ON `favourites` (`saved_at`);--> statement-breakpoint
CREATE TABLE `history` (
	`video_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`channel_title` text NOT NULL,
	`thumbnail_url` text NOT NULL,
	`duration_seconds` integer,
	`last_viewed_at` integer NOT NULL,
	`view_count` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "history_view_count_non_negative" CHECK("history"."view_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `history_last_viewed_at_idx` ON `history` (`last_viewed_at`);--> statement-breakpoint
CREATE TABLE `playlist_items` (
	`playlist_id` text NOT NULL,
	`video_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`playlist_id`, `video_id`),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "playlist_items_position_non_negative" CHECK("playlist_items"."position" >= 0)
);
--> statement-breakpoint
CREATE INDEX `playlist_items_playlist_id_position_idx` ON `playlist_items` (`playlist_id`,`position`);--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watch_later` (
	`video_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`channel_title` text NOT NULL,
	`thumbnail_url` text NOT NULL,
	`duration_seconds` integer,
	`saved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `watch_later_saved_at_idx` ON `watch_later` (`saved_at`);