ALTER TABLE `articles` ADD `content_status` text DEFAULT 'feed_ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `content_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `enrichment_queued_at` integer;--> statement-breakpoint
ALTER TABLE `articles` ADD `enrichment_attempted_at` integer;--> statement-breakpoint
ALTER TABLE `articles` ADD `enriched_at` integer;--> statement-breakpoint
ALTER TABLE `articles` ADD `enrichment_error` text;--> statement-breakpoint
ALTER TABLE `articles` ADD `enrichment_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `next_enrichment_at` integer;--> statement-breakpoint
CREATE INDEX `articles_enrichment_queue_idx` ON `articles` (`content_status`,`next_enrichment_at`);
--> statement-breakpoint
UPDATE `articles`
SET `content_status` = 'enrichment_pending',
    `enrichment_queued_at` = unixepoch(),
    `next_enrichment_at` = unixepoch()
WHERE `canonical_url` IS NOT NULL
  AND trim(`canonical_url`) <> ''
  AND `fetched_at` >= unixepoch('now', '-30 days');
