CREATE TABLE `article_saves` (
	`user_id` text NOT NULL,
	`article_id` text NOT NULL,
	`saved_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_saves_pk` ON `article_saves` (`user_id`,`article_id`);--> statement-breakpoint
CREATE INDEX `article_saves_user_saved_idx` ON `article_saves` (`user_id`,`saved_at`);--> statement-breakpoint
CREATE INDEX `article_saves_article_id_idx` ON `article_saves` (`article_id`);