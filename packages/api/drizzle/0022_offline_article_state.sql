CREATE TABLE `article_state_mutations` (
	`user_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`article_id` text NOT NULL,
	`kind` text NOT NULL,
	`desired_state` integer NOT NULL,
	`base_revision` integer,
	`resulting_state` integer NOT NULL,
	`resulting_revision` integer NOT NULL,
	`applied` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_state_mutations_pk` ON `article_state_mutations` (`user_id`,`mutation_id`);--> statement-breakpoint
CREATE INDEX `article_state_mutations_article_idx` ON `article_state_mutations` (`user_id`,`article_id`,`kind`);--> statement-breakpoint
CREATE TABLE `article_user_states` (
	`user_id` text NOT NULL,
	`article_id` text NOT NULL,
	`read_revision` integer DEFAULT 0 NOT NULL,
	`saved_revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_user_states_pk` ON `article_user_states` (`user_id`,`article_id`);--> statement-breakpoint
CREATE INDEX `article_user_states_article_id_idx` ON `article_user_states` (`article_id`);