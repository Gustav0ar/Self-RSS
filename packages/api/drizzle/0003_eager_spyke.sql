ALTER TABLE `feeds` ADD `next_sync_at` integer NOT NULL;--> statement-breakpoint
CREATE INDEX `feeds_next_sync_at_idx` ON `feeds` (`next_sync_at`,`sync_status`);