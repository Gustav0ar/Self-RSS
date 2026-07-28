UPDATE `feed_sources`
SET `min_interval_seconds` = 900;
--> statement-breakpoint
UPDATE `feed_sources`
SET `next_fetch_at` = min(`next_fetch_at`, unixepoch() + 900)
WHERE
	`state` = 'active'
	AND (`backoff_until` IS NULL OR `backoff_until` <= unixepoch());
