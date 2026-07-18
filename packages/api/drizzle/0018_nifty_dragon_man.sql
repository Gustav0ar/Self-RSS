ALTER TABLE `feed_sources` ADD `last_unconditional_fetch_at` integer;
--> statement-breakpoint
ALTER TABLE `feed_fetch_snapshots` ADD `cache_control` text;
--> statement-breakpoint
ALTER TABLE `feed_fetch_snapshots` ADD `expires` text;
