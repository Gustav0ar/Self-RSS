UPDATE `user_preferences`
SET
	`auto_mark_read_mode` = 'on_navigate',
	`updated_at` = CAST(strftime('%s', 'now') AS INTEGER)
WHERE `auto_mark_read_mode` = 'disabled';
