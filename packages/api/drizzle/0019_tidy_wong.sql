ALTER TABLE `auth_sessions` ADD `expires_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `auth_sessions` SET `expires_at` = `created_at` + 34560000;--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_at_idx` ON `auth_sessions` (`expires_at`);
