ALTER TABLE `user_metrics_daily` ADD `articles_saved_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_metrics_daily` ADD `offline_restores_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_metrics_daily` ADD `articles_completed_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_metrics_daily` ADD `feed_failures_count` integer DEFAULT 0 NOT NULL;
