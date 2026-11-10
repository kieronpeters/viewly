-- Backfill the HTML entities YouTube puts in snippet text.
--
-- Rows written before `decodeHtmlEntities` ran inside the normalizers stored
-- that text verbatim, so a home shelf heading could read
-- "Because you watched Don&#39;t ...". New writes are decoded at normalization;
-- this migration decodes the rows that already exist.
--
-- ## Exactly once
--
-- Drizzle records this migration in `__drizzle_migrations`, so it runs once per
-- database. The order below decodes one level only: every named entity is
-- replaced before `&amp;`, therefore `&amp;amp;` becomes `&amp;` rather than `&`,
-- and a literal `&` (for example "Tom & Jerry") is never touched.
--
-- ## Scope
--
-- Only YouTube-supplied snapshot text is decoded: the `title` and
-- `channel_title` copies in `history`, `favourites` and `watch_later`. Playlist
-- names (`playlists.name`) and note bodies (`video_notes.body`) are user input
-- and must keep whatever the viewer typed.
--
-- `playlist_items` deliberately has no statement here: the table has no `title`
-- or `channel_title` column (`src/db/schema.ts`, and "Known gaps" in
-- `docs/YOUTUBE_DATA_POLICY.md`), so an UPDATE against it would make this
-- migration fail on every database that has only 0000-0004 applied. When the
-- playlist snapshot columns are added, the two expressions below can be copied
-- into an UPDATE for that table.
UPDATE `history` SET
	`title` = replace(replace(replace(replace(replace(replace(replace(replace(`title`, '&#39;', ''''), '&#x27;', ''''), '&#X27;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '), '&amp;', '&'),
	`channel_title` = replace(replace(replace(replace(replace(replace(replace(replace(`channel_title`, '&#39;', ''''), '&#x27;', ''''), '&#X27;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '), '&amp;', '&');
--> statement-breakpoint
UPDATE `favourites` SET
	`title` = replace(replace(replace(replace(replace(replace(replace(replace(`title`, '&#39;', ''''), '&#x27;', ''''), '&#X27;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '), '&amp;', '&'),
	`channel_title` = replace(replace(replace(replace(replace(replace(replace(replace(`channel_title`, '&#39;', ''''), '&#x27;', ''''), '&#X27;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '), '&amp;', '&');
--> statement-breakpoint
UPDATE `watch_later` SET
	`title` = replace(replace(replace(replace(replace(replace(replace(replace(`title`, '&#39;', ''''), '&#x27;', ''''), '&#X27;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '), '&amp;', '&'),
	`channel_title` = replace(replace(replace(replace(replace(replace(replace(replace(`channel_title`, '&#39;', ''''), '&#x27;', ''''), '&#X27;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '), '&amp;', '&');
