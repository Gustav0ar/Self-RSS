CREATE INDEX IF NOT EXISTS `articles_feed_sort_idx` ON `articles` (`feed_id`, coalesce(`published_at`, `fetched_at`), `id`);
