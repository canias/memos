package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

const scheduleColumns = "id, EXTRACT(EPOCH FROM created_ts)::BIGINT, EXTRACT(EPOCH FROM updated_ts)::BIGINT, creator_id, space_id, row_status, content, visibility, every_n_days, weekday_mask, start_ts, next_run_ts, EXTRACT(EPOCH FROM last_fired_ts)::BIGINT, last_created_memo_uid"

func (d *DB) CreateSchedule(ctx context.Context, create *store.Schedule) (*store.Schedule, error) {
	var id int32
	if err := d.db.QueryRowContext(ctx,
		"INSERT INTO schedule (creator_id, space_id, row_status, content, visibility, every_n_days, weekday_mask, start_ts, next_run_ts, last_fired_ts, last_created_memo_uid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id",
		create.CreatorID, create.SpaceID, create.RowStatus, create.Content, create.Visibility, create.EveryNDays, create.WeekdayMask, create.StartTs, create.NextRunTs, create.LastFiredTs, create.LastCreatedMemoUID,
	).Scan(&id); err != nil {
		return nil, errors.Wrap(err, "failed to create schedule")
	}
	return d.GetSchedule(ctx, &store.FindSchedule{ID: &id})
}

func (d *DB) ListSchedules(ctx context.Context, find *store.FindSchedule) ([]*store.Schedule, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "id = $1"), append(args, *find.ID)
	}
	if find.CreatorID != nil {
		where, args = append(where, fmt.Sprintf("creator_id = $%d", len(args)+1)), append(args, *find.CreatorID)
	}
	if find.DueBefore != nil {
		where, args = append(where, fmt.Sprintf("row_status = 'NORMAL' AND next_run_ts <= $%d", len(args)+1)), append(args, *find.DueBefore)
	}
	query := "SELECT " + scheduleColumns + " FROM schedule WHERE " + strings.Join(where, " AND ") + " ORDER BY next_run_ts ASC"
	argIndex := len(args)
	if find.Limit != nil {
		argIndex++
		query += fmt.Sprintf(" LIMIT $%d", argIndex)
		args = append(args, *find.Limit)
	}
	if find.Offset != nil {
		argIndex++
		query += fmt.Sprintf(" OFFSET $%d", argIndex)
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
	sets, args := []string{}, []any{}
	if v := update.Content; v != nil {
		sets, args = append(sets, fmt.Sprintf("content = $%d", len(args)+1)), append(args, *v)
	}
	if v := update.Visibility; v != nil {
		sets, args = append(sets, fmt.Sprintf("visibility = $%d", len(args)+1)), append(args, *v)
	}
	if update.ClearSpace {
		sets = append(sets, "space_id = NULL")
	} else if v := update.SpaceID; v != nil {
		sets, args = append(sets, fmt.Sprintf("space_id = $%d", len(args)+1)), append(args, *v)
	}
	if v := update.RowStatus; v != nil {
		sets, args = append(sets, fmt.Sprintf("row_status = $%d", len(args)+1)), append(args, *v)
	}
	if update.ClearEveryNDays {
		sets = append(sets, "every_n_days = NULL")
	} else if v := update.EveryNDays; v != nil {
		sets, args = append(sets, fmt.Sprintf("every_n_days = $%d", len(args)+1)), append(args, *v)
	}
	if update.ClearWeekdayMask {
		sets = append(sets, "weekday_mask = NULL")
	} else if v := update.WeekdayMask; v != nil {
		sets, args = append(sets, fmt.Sprintf("weekday_mask = $%d", len(args)+1)), append(args, *v)
	}
	if v := update.StartTs; v != nil {
		sets, args = append(sets, fmt.Sprintf("start_ts = $%d", len(args)+1)), append(args, *v)
	}
	if v := update.NextRunTs; v != nil {
		sets, args = append(sets, fmt.Sprintf("next_run_ts = $%d", len(args)+1)), append(args, *v)
	}
	if update.SetLastFired {
		sets, args = append(sets, fmt.Sprintf("last_fired_ts = $%d", len(args)+1)), append(args, update.LastFiredTs)
	}
	if v := update.LastCreatedMemoUID; v != nil {
		sets, args = append(sets, fmt.Sprintf("last_created_memo_uid = $%d", len(args)+1)), append(args, *v)
	}
	sets = append(sets, "updated_ts = EXTRACT(EPOCH FROM NOW())::BIGINT")
	args = append(args, update.ID)
	if _, err := d.db.ExecContext(ctx, "UPDATE schedule SET "+strings.Join(sets, ", ")+" WHERE id = $"+fmt.Sprint(len(args)), args...); err != nil {
		return nil, errors.Wrap(err, "failed to update schedule")
	}
	return d.GetSchedule(ctx, &store.FindSchedule{ID: &update.ID})
}

func (d *DB) DeleteSchedule(ctx context.Context, delete *store.DeleteSchedule) error {
	if _, err := d.db.ExecContext(ctx, "DELETE FROM schedule WHERE id = $1", delete.ID); err != nil {
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
