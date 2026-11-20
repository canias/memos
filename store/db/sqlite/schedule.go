package sqlite

import (
	"context"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

const scheduleColumns = "`id`, `created_ts`, `updated_ts`, `creator_id`, `space_id`, `row_status`, `content`, `visibility`, `every_n_days`, `weekday_mask`, `start_ts`, `next_run_ts`, `last_fired_ts`, `last_created_memo_uid`"

func (d *DB) CreateSchedule(ctx context.Context, create *store.Schedule) (*store.Schedule, error) {
	var id int32
	err := d.db.QueryRowContext(ctx,
		"INSERT INTO `schedule` (`creator_id`, `space_id`, `row_status`, `content`, `visibility`, `every_n_days`, `weekday_mask`, `start_ts`, `next_run_ts`, `last_fired_ts`, `last_created_memo_uid`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING `id`",
		create.CreatorID, create.SpaceID, create.RowStatus, create.Content, create.Visibility, create.EveryNDays, create.WeekdayMask, create.StartTs, create.NextRunTs, create.LastFiredTs, create.LastCreatedMemoUID,
	).Scan(&id)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create schedule")
	}
	return d.GetSchedule(ctx, &store.FindSchedule{ID: &id})
}

func (d *DB) ListSchedules(ctx context.Context, find *store.FindSchedule) ([]*store.Schedule, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.CreatorID != nil {
		where, args = append(where, "`creator_id` = ?"), append(args, *find.CreatorID)
	}
	if find.DueBefore != nil {
		where = append(where, "`row_status` = 'NORMAL' AND `next_run_ts` <= ?")
		args = append(args, *find.DueBefore)
	}
	query := "SELECT " + scheduleColumns + " FROM `schedule` WHERE " + strings.Join(where, " AND ") + " ORDER BY `next_run_ts` ASC"
	if find.Limit != nil {
		query += " LIMIT ?"
		args = append(args, *find.Limit)
	}
	if find.Offset != nil {
		// SQLite requires LIMIT when OFFSET is used.
		if find.Limit == nil {
			query += " LIMIT ?"
			args = append(args, -1)
		}
		query += " OFFSET ?"
		args = append(args, *find.Offset)
	}

	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list schedules")
	}
	defer rows.Close()
	list := make([]*store.Schedule, 0)
	for rows.Next() {
		schedule, scanErr := scanSchedule(rows)
		if scanErr != nil {
			return nil, errors.Wrap(scanErr, "failed to scan schedule")
		}
		list = append(list, schedule)
	}
	return list, rows.Err()
}

func (d *DB) GetSchedule(ctx context.Context, find *store.FindSchedule) (*store.Schedule, error) {
	schedules, err := d.ListSchedules(ctx, find)
	if err != nil {
		return nil, err
	}
	if len(schedules) == 0 {
		return nil, nil
	}
	return schedules[0], nil
}

func (d *DB) UpdateSchedule(ctx context.Context, update *store.UpdateSchedule) (*store.Schedule, error) {
	set, args := []string{}, []any{}
	if v := update.Content; v != nil {
		set, args = append(set, "`content` = ?"), append(args, *v)
	}
	if v := update.Visibility; v != nil {
		set, args = append(set, "`visibility` = ?"), append(args, *v)
	}
	if update.ClearSpace {
		set = append(set, "`space_id` = NULL")
	} else if v := update.SpaceID; v != nil {
		set, args = append(set, "`space_id` = ?"), append(args, *v)
	}
	if v := update.RowStatus; v != nil {
		set, args = append(set, "`row_status` = ?"), append(args, *v)
	}
	if update.ClearEveryNDays {
		set = append(set, "`every_n_days` = NULL")
	} else if v := update.EveryNDays; v != nil {
		set, args = append(set, "`every_n_days` = ?"), append(args, *v)
	}
	if update.ClearWeekdayMask {
		set = append(set, "`weekday_mask` = NULL")
	} else if v := update.WeekdayMask; v != nil {
		set, args = append(set, "`weekday_mask` = ?"), append(args, *v)
	}
	if v := update.StartTs; v != nil {
		set, args = append(set, "`start_ts` = ?"), append(args, *v)
	}
	if v := update.NextRunTs; v != nil {
		set, args = append(set, "`next_run_ts` = ?"), append(args, *v)
	}
	if update.SetLastFired {
		set, args = append(set, "`last_fired_ts` = ?"), append(args, update.LastFiredTs)
	}
	if v := update.LastCreatedMemoUID; v != nil {
		set, args = append(set, "`last_created_memo_uid` = ?"), append(args, *v)
	}
	set = append(set, "`updated_ts` = strftime('%s', 'now')")
	args = append(args, update.ID)
	if _, err := d.db.ExecContext(ctx, "UPDATE `schedule` SET "+strings.Join(set, ", ")+" WHERE `id` = ?", args...); err != nil {
		return nil, errors.Wrap(err, "failed to update schedule")
	}
	return d.GetSchedule(ctx, &store.FindSchedule{ID: &update.ID})
}

func (d *DB) DeleteSchedule(ctx context.Context, delete *store.DeleteSchedule) error {
	if _, err := d.db.ExecContext(ctx, "DELETE FROM `schedule` WHERE `id` = ?", delete.ID); err != nil {
		return errors.Wrap(err, "failed to delete schedule")
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSchedule(scan rowScanner) (*store.Schedule, error) {
	schedule := &store.Schedule{}
	if err := scan.Scan(&schedule.ID, &schedule.CreatedTs, &schedule.UpdatedTs, &schedule.CreatorID, &schedule.SpaceID, &schedule.RowStatus, &schedule.Content, &schedule.Visibility, &schedule.EveryNDays, &schedule.WeekdayMask, &schedule.StartTs, &schedule.NextRunTs, &schedule.LastFiredTs, &schedule.LastCreatedMemoUID); err != nil {
		return nil, err
	}
	return schedule, nil
}
