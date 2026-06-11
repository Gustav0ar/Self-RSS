PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`site_url` text,
	`feed_url` text NOT NULL,
	`favicon_url` text,
	`description` text,
	`polling_interval_minutes` integer DEFAULT 60 NOT NULL,
	`last_synced_at` integer,
	`next_sync_at` integer NOT NULL,
	`sync_status` text DEFAULT 'idle' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_feeds`("id", "user_id", "category_id", "title", "site_url", "feed_url", "favicon_url", "description", "polling_interval_minutes", "last_synced_at", "next_sync_at", "sync_status", "created_at", "updated_at") SELECT "id", "user_id", "category_id", "title", "site_url", "feed_url", "favicon_url", "description", "polling_interval_minutes", "last_synced_at", unixepoch(), "sync_status", "created_at", "updated_at" FROM `feeds`;--> statement-breakpoint
DROP TABLE `feeds`;--> statement-breakpoint
ALTER TABLE `__new_feeds` RENAME TO `feeds`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `feeds_user_feed_url_idx` ON `feeds` (`user_id`,`feed_url`);--> statement-breakpoint
CREATE INDEX `feeds_user_id_idx` ON `feeds` (`user_id`);--> statement-breakpoint
CREATE INDEX `feeds_category_id_idx` ON `feeds` (`category_id`);--> statement-breakpoint
CREATE INDEX `feeds_next_sync_at_idx` ON `feeds` (`next_sync_at`,`sync_status`);