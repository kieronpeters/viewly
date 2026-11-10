PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_video_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`body` text NOT NULL,
	`start_seconds` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "video_notes_start_seconds_non_negative" CHECK("__new_video_notes"."start_seconds" is null or "__new_video_notes"."start_seconds" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_video_notes`("id", "video_id", "body", "start_seconds", "created_at", "updated_at") SELECT "id", "video_id", "body", NULL, "created_at", "updated_at" FROM `video_notes`;--> statement-breakpoint
DROP TABLE `video_notes`;--> statement-breakpoint
ALTER TABLE `__new_video_notes` RENAME TO `video_notes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `video_notes_video_id_created_at_idx` ON `video_notes` (`video_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `video_notes_video_id_start_seconds_idx` ON `video_notes` (`video_id`,`start_seconds`);