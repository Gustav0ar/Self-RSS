CREATE INDEX IF NOT EXISTS `articles_sort_idx` ON `articles` (coalesce(`published_at`, `fetched_at`), `id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sync_runs_started_at_idx` ON `sync_runs` (`started_at`);
