CREATE TABLE `feed_discovery_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text,
	`input_url` text NOT NULL,
	`candidate_url` text NOT NULL,
	`normalized_candidate_url` text NOT NULL,
	`title` text,
	`type` text DEFAULT 'feed' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`selected_at` integer,
	`selection_metadata` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_discovery_candidates_request_url_idx` ON `feed_discovery_candidates` (`request_id`,`normalized_candidate_url`);--> statement-breakpoint
CREATE INDEX `feed_discovery_candidates_user_request_idx` ON `feed_discovery_candidates` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `feed_discovery_candidates_expiry_idx` ON `feed_discovery_candidates` (`expires_at`,`status`);--> statement-breakpoint
CREATE TABLE `feed_fetch_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'scheduled' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`source_id` text NOT NULL,
	`origin_id` text NOT NULL,
	`refresh_request_id` text,
	`snapshot_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`available_at` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`last_error_code` text,
	`last_error_details` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`dead_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `feed_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origin_id`) REFERENCES `feed_origins`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`refresh_request_id`) REFERENCES `feed_refresh_requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`snapshot_id`) REFERENCES `feed_fetch_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "feed_fetch_jobs_attempts_check" CHECK("feed_fetch_jobs"."attempts" >= 0 AND "feed_fetch_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE INDEX `feed_fetch_jobs_claim_idx` ON `feed_fetch_jobs` (`status`,`available_at`,"priority" desc,`created_at`);--> statement-breakpoint
CREATE INDEX `feed_fetch_jobs_lease_recovery_idx` ON `feed_fetch_jobs` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `feed_fetch_jobs_source_created_idx` ON `feed_fetch_jobs` (`source_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `feed_fetch_jobs_origin_status_idx` ON `feed_fetch_jobs` (`origin_id`,`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `feed_fetch_jobs_refresh_request_idx` ON `feed_fetch_jobs` (`refresh_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `feed_fetch_jobs_active_source_idx` ON `feed_fetch_jobs` (`source_id`) WHERE `status` IN ('queued', 'running');--> statement-breakpoint
CREATE TABLE `feed_fetch_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`job_id` text,
	`fetched_at` integer NOT NULL,
	`final_url` text NOT NULL,
	`http_status` integer,
	`content_type` text,
	`etag` text,
	`last_modified` text,
	`raw_body` text,
	`raw_body_ref` text,
	`raw_body_bytes` integer DEFAULT 0 NOT NULL,
	`raw_body_hash` text,
	`body_expires_at` integer,
	`normalized_payload` text,
	`normalized_payload_bytes` integer DEFAULT 0 NOT NULL,
	`normalized_payload_hash` text,
	`parser_version` text,
	`parse_state` text DEFAULT 'pending' NOT NULL,
	`parse_error_code` text,
	`parse_error_details` text,
	`retain_until` integer,
	`cleanup_after` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `feed_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `feed_fetch_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "feed_fetch_snapshots_body_size_check" CHECK("feed_fetch_snapshots"."raw_body_bytes" >= 0 AND "feed_fetch_snapshots"."normalized_payload_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_fetch_snapshots_job_idx` ON `feed_fetch_snapshots` (`job_id`) WHERE "feed_fetch_snapshots"."job_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `feed_fetch_snapshots_source_fetched_idx` ON `feed_fetch_snapshots` (`source_id`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `feed_fetch_snapshots_cleanup_idx` ON `feed_fetch_snapshots` (`cleanup_after`,`retain_until`);--> statement-breakpoint
CREATE TABLE `feed_origins` (
	`id` text PRIMARY KEY NOT NULL,
	`scheme` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`last_request_at` integer,
	`next_allowed_request_at` integer,
	`retry_after_until` integer,
	`blocked_until` integer,
	`block_reason` text,
	`circuit_state` text DEFAULT 'closed' NOT NULL,
	`circuit_opened_at` integer,
	`consecutive_failure_count` integer DEFAULT 0 NOT NULL,
	`last_failure_at` integer,
	`last_success_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_origins_identity_idx` ON `feed_origins` (`scheme`,`host`,`port`);--> statement-breakpoint
CREATE INDEX `feed_origins_next_allowed_idx` ON `feed_origins` (`next_allowed_request_at`);--> statement-breakpoint
CREATE INDEX `feed_origins_circuit_idx` ON `feed_origins` (`circuit_state`,`blocked_until`);--> statement-breakpoint
CREATE TABLE `feed_refresh_request_items` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`feed_id` text,
	`source_id` text,
	`job_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`last_error_details` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `feed_refresh_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_id`) REFERENCES `feed_sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `feed_fetch_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_refresh_request_items_request_feed_idx` ON `feed_refresh_request_items` (`request_id`,`feed_id`);--> statement-breakpoint
CREATE INDEX `feed_refresh_request_items_request_status_idx` ON `feed_refresh_request_items` (`request_id`,`status`);--> statement-breakpoint
CREATE INDEX `feed_refresh_request_items_feed_created_idx` ON `feed_refresh_request_items` (`feed_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `feed_refresh_request_items_job_idx` ON `feed_refresh_request_items` (`job_id`);--> statement-breakpoint
CREATE TABLE `feed_refresh_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text,
	`scope_type` text DEFAULT 'all' NOT NULL,
	`scope_feed_id` text,
	`scope_category_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_items` integer DEFAULT 0 NOT NULL,
	`pending_items` integer DEFAULT 0 NOT NULL,
	`running_items` integer DEFAULT 0 NOT NULL,
	`completed_items` integer DEFAULT 0 NOT NULL,
	`failed_items` integer DEFAULT 0 NOT NULL,
	`dead_items` integer DEFAULT 0 NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scope_feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`scope_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_refresh_requests_user_idempotency_idx` ON `feed_refresh_requests` (`user_id`,`idempotency_key`) WHERE "feed_refresh_requests"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `feed_refresh_requests_user_created_idx` ON `feed_refresh_requests` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `feed_refresh_requests_status_idx` ON `feed_refresh_requests` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `feed_refresh_requests_expiry_idx` ON `feed_refresh_requests` (`expires_at`);--> statement-breakpoint
CREATE TABLE `feed_snapshot_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`feed_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`available_at` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`last_error_code` text,
	`last_error_details` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`dead_at` integer,
	FOREIGN KEY (`snapshot_id`) REFERENCES `feed_fetch_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "feed_snapshot_deliveries_attempts_check" CHECK("feed_snapshot_deliveries"."attempts" >= 0 AND "feed_snapshot_deliveries"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_snapshot_deliveries_snapshot_feed_idx` ON `feed_snapshot_deliveries` (`snapshot_id`,`feed_id`);--> statement-breakpoint
CREATE INDEX `feed_snapshot_deliveries_claim_idx` ON `feed_snapshot_deliveries` (`status`,`available_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `feed_snapshot_deliveries_lease_recovery_idx` ON `feed_snapshot_deliveries` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `feed_snapshot_deliveries_feed_idx` ON `feed_snapshot_deliveries` (`feed_id`,`status`);--> statement-breakpoint
CREATE TABLE `feed_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_url` text NOT NULL,
	`requested_url` text NOT NULL,
	`resolved_url` text,
	`origin_id` text NOT NULL,
	`title` text,
	`site_url` text,
	`description` text,
	`language` text,
	`image_url` text,
	`etag` text,
	`last_modified` text,
	`last_http_status` integer,
	`last_fetch_at` integer,
	`last_success_at` integer,
	`last_change_at` integer,
	`next_fetch_at` integer NOT NULL,
	`min_interval_seconds` integer DEFAULT 900 NOT NULL,
	`consecutive_failure_count` integer DEFAULT 0 NOT NULL,
	`consecutive_unchanged_count` integer DEFAULT 0 NOT NULL,
	`backoff_until` integer,
	`circuit_state` text DEFAULT 'closed' NOT NULL,
	`circuit_opened_at` integer,
	`parser_version` text,
	`raw_body_hash` text,
	`normalized_payload_hash` text,
	`publisher_hints` text,
	`state` text DEFAULT 'active' NOT NULL,
	`last_error_code` text,
	`last_error_details` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`origin_id`) REFERENCES `feed_origins`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "feed_sources_min_interval_check" CHECK("feed_sources"."min_interval_seconds" >= 900)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_sources_normalized_url_idx` ON `feed_sources` (`normalized_url`);--> statement-breakpoint
CREATE INDEX `feed_sources_origin_id_idx` ON `feed_sources` (`origin_id`);--> statement-breakpoint
CREATE INDEX `feed_sources_due_idx` ON `feed_sources` (`state`,`next_fetch_at`);--> statement-breakpoint
CREATE INDEX `feed_sources_circuit_idx` ON `feed_sources` (`circuit_state`,`backoff_until`);--> statement-breakpoint
ALTER TABLE `feeds` ADD `source_id` text REFERENCES feed_sources(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `feeds` ADD `pending_source_id` text REFERENCES feed_sources(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `feeds` ADD `custom_title` text;--> statement-breakpoint
ALTER TABLE `feeds` ADD `replacement_requested_at` integer;--> statement-breakpoint
ALTER TABLE `feeds` ADD `refresh_blocked_until` integer;--> statement-breakpoint
ALTER TABLE `feeds` ADD `last_sync_error_code` text;--> statement-breakpoint
CREATE INDEX `feeds_source_id_idx` ON `feeds` (`source_id`);--> statement-breakpoint
CREATE INDEX `feeds_pending_source_id_idx` ON `feeds` (`pending_source_id`);--> statement-breakpoint
CREATE INDEX `feeds_refresh_blocked_until_idx` ON `feeds` (`refresh_blocked_until`);--> statement-breakpoint

-- URL identity is intentionally conservative for the one-time, offline backfill.
-- `normalized_url` is the exact trimmed legacy URL: this avoids merging URLs by
-- query ordering, path case, trailing slash, redirects, or other equivalence that
-- cannot be proven without network access. Scheme/host case normalization is used
-- only for the separate origin throttle identity.
CREATE TEMP TABLE `feed_ingestion_backfill` AS
WITH normalized AS (
	SELECT
		`id` AS `feed_id`,
		trim(`feed_url`) AS `normalized_url`,
		`title`,
		`site_url`,
		`description`,
		`polling_interval_minutes`,
		`last_synced_at`,
		`last_sync_error`,
		`last_sync_error_at`,
		`next_sync_at`,
		`created_at`,
		`updated_at`
	FROM `feeds`
), url_parts AS (
	SELECT *,
		CASE
			WHEN instr(`normalized_url`, '://') > 1
				THEN lower(substr(`normalized_url`, 1, instr(`normalized_url`, '://') - 1))
			ELSE 'unknown'
		END AS `scheme`,
		CASE
			WHEN instr(`normalized_url`, '://') > 1
				THEN substr(`normalized_url`, instr(`normalized_url`, '://') + 3)
			ELSE `normalized_url`
		END AS `after_scheme`
	FROM normalized
), authorities AS (
	SELECT *,
		substr(
			replace(replace(`after_scheme`, '?', '/'), '#', '/'),
			1,
			instr(replace(replace(`after_scheme`, '?', '/'), '#', '/') || '/', '/') - 1
		) AS `authority`
	FROM url_parts
), origin_parts AS (
	SELECT *,
		CASE
			WHEN substr(`authority`, 1, 1) = '[' AND instr(`authority`, ']') > 1
				THEN lower(substr(`authority`, 2, instr(`authority`, ']') - 2))
			WHEN instr(`authority`, ':') > 0
				THEN lower(substr(`authority`, 1, instr(`authority`, ':') - 1))
			ELSE lower(`authority`)
		END AS `host`,
		CASE
			WHEN substr(`authority`, 1, 1) = '['
				AND instr(`authority`, ']') > 1
				AND substr(`authority`, instr(`authority`, ']') + 1, 1) = ':'
				THEN CAST(substr(`authority`, instr(`authority`, ']') + 2) AS INTEGER)
			WHEN substr(`authority`, 1, 1) <> '[' AND instr(`authority`, ':') > 0
				THEN CAST(substr(`authority`, instr(`authority`, ':') + 1) AS INTEGER)
			WHEN `scheme` = 'https' THEN 443
			WHEN `scheme` = 'http' THEN 80
			ELSE 0
		END AS `port`
	FROM authorities
)
SELECT *, 'origin:' || `scheme` || '://' || `host` || ':' || `port` AS `origin_id`
FROM origin_parts;--> statement-breakpoint

INSERT INTO `feed_origins` (
	`id`, `scheme`, `host`, `port`, `created_at`, `updated_at`
)
SELECT
	`origin_id`, `scheme`, `host`, `port`, min(`created_at`), max(`updated_at`)
FROM `feed_ingestion_backfill`
GROUP BY `origin_id`, `scheme`, `host`, `port`;--> statement-breakpoint

INSERT INTO `feed_sources` (
	`id`, `normalized_url`, `requested_url`, `resolved_url`, `origin_id`,
	`title`, `site_url`, `description`, `last_fetch_at`, `last_success_at`,
	`next_fetch_at`, `min_interval_seconds`, `consecutive_failure_count`,
	`state`, `last_error_code`, `last_error_details`, `created_at`, `updated_at`
)
SELECT
	'source:' || min(`feed_id`),
	`normalized_url`,
	`normalized_url`,
	`normalized_url`,
	min(`origin_id`),
	min(`title`),
	min(`site_url`),
	min(`description`),
	max(CASE
		WHEN coalesce(`last_sync_error_at`, 0) > coalesce(`last_synced_at`, 0)
			THEN `last_sync_error_at`
		ELSE `last_synced_at`
	END),
	max(`last_synced_at`),
	min(coalesce(`next_sync_at`, unixepoch())),
	max(900, max(coalesce(`polling_interval_minutes`, 15)) * 60),
	CASE
		WHEN max(coalesce(`last_sync_error_at`, 0)) > max(coalesce(`last_synced_at`, 0)) THEN 1
		ELSE 0
	END,
	'active',
	CASE
		WHEN max(coalesce(`last_sync_error_at`, 0)) > max(coalesce(`last_synced_at`, 0))
			THEN 'legacy_sync_error'
		ELSE NULL
	END,
	CASE
		WHEN max(coalesce(`last_sync_error_at`, 0)) > max(coalesce(`last_synced_at`, 0))
			THEN max(`last_sync_error`)
		ELSE NULL
	END,
	min(`created_at`),
	max(`updated_at`)
FROM `feed_ingestion_backfill`
GROUP BY `normalized_url`;--> statement-breakpoint

UPDATE `feeds`
SET
	`source_id` = (
		SELECT `feed_sources`.`id`
		FROM `feed_sources`
		WHERE `feed_sources`.`normalized_url` = trim(`feeds`.`feed_url`)
	),
	`custom_title` = `title`;--> statement-breakpoint

DROP TABLE `feed_ingestion_backfill`;
