-- The schedule drives memos the instance will publish later: a Markdown template plus
-- a recurrence. start_ts is the first fire; a plan with neither every_n_days nor a
-- weekday mask fires once and retires. next_run_ts is when it publishes next.
CREATE TABLE IF NOT EXISTS `schedule` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `created_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `creator_id` INT NOT NULL,
  `space_id` INT DEFAULT NULL,
  `row_status` VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
  `content` TEXT NOT NULL,
  `visibility` VARCHAR(32) NOT NULL DEFAULT 'PRIVATE',
  `every_n_days` INT DEFAULT NULL,
  `weekday_mask` INT DEFAULT NULL,
  `start_ts` BIGINT NOT NULL,
  `next_run_ts` BIGINT NOT NULL,
  `last_fired_ts` BIGINT DEFAULT NULL,
  `last_created_memo_uid` VARCHAR(64) DEFAULT NULL,
  KEY `idx_schedule_creator` (`creator_id`),
  KEY `idx_schedule_next_run` (`next_run_ts`)
);
