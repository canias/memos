-- The schedule drives memos the instance will publish later: a Markdown template plus
-- a recurrence. start_ts is the first fire; a plan with neither every_n_days nor a
-- weekday mask fires once and retires. next_run_ts is when it publishes next.
CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  creator_id INTEGER NOT NULL,
  space_id INTEGER DEFAULT NULL,
  row_status TEXT NOT NULL DEFAULT 'NORMAL',
  content TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  every_n_days INTEGER DEFAULT NULL,
  weekday_mask INTEGER DEFAULT NULL,
  start_ts BIGINT NOT NULL,
  next_run_ts BIGINT NOT NULL,
  last_fired_ts BIGINT DEFAULT NULL,
  last_created_memo_uid TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_creator ON schedule(creator_id);
CREATE INDEX IF NOT EXISTS idx_schedule_next_run ON schedule(next_run_ts);
