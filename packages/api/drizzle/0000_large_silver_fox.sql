CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`registration_locked` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `article_media` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text DEFAULT 'unknown' NOT NULL,
	`url` text NOT NULL,
	`embed_url` text,
	`width` integer,
	`height` integer,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `article_media_article_id_idx` ON `article_media` (`article_id`);--> statement-breakpoint
CREATE TABLE `article_reads` (
	`user_id` text NOT NULL,
	`article_id` text NOT NULL,
	`read_at` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_reads_pk` ON `article_reads` (`user_id`,`article_id`);--> statement-breakpoint
CREATE INDEX `article_reads_user_id_idx` ON `article_reads` (`user_id`);--> statement-breakpoint
CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`guid` text NOT NULL,
	`canonical_url` text,
	`title` text NOT NULL,
	`author` text,
	`excerpt` text,
	`content_html` text,
	`content_text` text,
	`hero_image_url` text,
	`published_at` integer,
	`fetched_at` integer NOT NULL,
	`hash` text NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_feed_guid_idx` ON `articles` (`feed_id`,`guid`);--> statement-breakpoint
CREATE INDEX `articles_feed_id_idx` ON `articles` (`feed_id`);--> statement-breakpoint
CREATE INDEX `articles_published_at_idx` ON `articles` (`published_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`details` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_logs_admin_user_id_idx` ON `audit_logs` (`admin_user_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_category_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_slug_idx` ON `categories` (`user_id`,`slug`);--> statement-breakpoint
CREATE INDEX `categories_user_id_idx` ON `categories` (`user_id`);--> statement-breakpoint
CREATE TABLE `feeds` (
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
	`sync_status` text DEFAULT 'idle' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feeds_user_feed_url_idx` ON `feeds` (`user_id`,`feed_url`);--> statement-breakpoint
CREATE INDEX `feeds_user_id_idx` ON `feeds` (`user_id`);--> statement-breakpoint
CREATE INDEX `feeds_category_id_idx` ON `feeds` (`category_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`http_status` integer,
	`item_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_runs_feed_id_idx` ON `sync_runs` (`feed_id`);--> statement-breakpoint
CREATE TABLE `user_metrics_daily` (
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`articles_read_count` integer DEFAULT 0 NOT NULL,
	`feeds_synced_count` integer DEFAULT 0 NOT NULL,
	`search_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_metrics_daily_pk` ON `user_metrics_daily` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`font_family` text DEFAULT 'Inter' NOT NULL,
	`text_size` integer DEFAULT 16 NOT NULL,
	`density` text DEFAULT 'comfortable' NOT NULL,
	`default_sort` text DEFAULT 'latest' NOT NULL,
	`hide_read` integer DEFAULT false NOT NULL,
	`keyboard_shortcuts_enabled` integer DEFAULT true NOT NULL,
	`auto_mark_read_mode` text DEFAULT 'disabled' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);