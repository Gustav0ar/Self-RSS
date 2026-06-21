CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`client_id` text,
	`device_name` text DEFAULT 'Unknown device' NOT NULL,
	`user_agent` text,
	`ip_address` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`rotated_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_id_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_revoked_idx` ON `auth_sessions` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_refresh_token_hash_idx` ON `auth_sessions` (`refresh_token_hash`);