CREATE VIRTUAL TABLE IF NOT EXISTS `articles_fts` USING fts5(
	`article_id` UNINDEXED,
	`title`,
	`content_text`
);
--> statement-breakpoint
INSERT INTO `articles_fts` (`article_id`, `title`, `content_text`)
SELECT `id`, `title`, coalesce(`content_text`, '')
FROM `articles`
WHERE NOT EXISTS (
	SELECT 1 FROM `articles_fts` WHERE `articles_fts`.`article_id` = `articles`.`id`
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `articles_fts_ai` AFTER INSERT ON `articles`
BEGIN
	INSERT INTO `articles_fts` (`article_id`, `title`, `content_text`)
	VALUES (new.`id`, new.`title`, coalesce(new.`content_text`, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `articles_fts_ad` AFTER DELETE ON `articles`
BEGIN
	DELETE FROM `articles_fts` WHERE `article_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `articles_fts_au` AFTER UPDATE OF `title`, `content_text` ON `articles`
BEGIN
	DELETE FROM `articles_fts` WHERE `article_id` = old.`id`;
	INSERT INTO `articles_fts` (`article_id`, `title`, `content_text`)
	VALUES (new.`id`, new.`title`, coalesce(new.`content_text`, ''));
END;
