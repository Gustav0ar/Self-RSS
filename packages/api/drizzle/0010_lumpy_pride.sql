DROP INDEX `categories_user_slug_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_root_slug_idx` ON `categories` (`user_id`,`slug`) WHERE "categories"."parent_category_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_parent_slug_idx` ON `categories` (`user_id`,`parent_category_id`,`slug`) WHERE "categories"."parent_category_id" IS NOT NULL;