-- Reduce default polling interval from 60 minutes to 5 minutes for faster feed updates.
-- Also updates existing feeds that still have the default 60-minute interval to use 5 minutes.
-- Users who explicitly set a custom polling interval are not affected.
UPDATE `feeds` SET `polling_interval_minutes` = 5 WHERE `polling_interval_minutes` = 60;
