package store

import (
	"context"

	"github.com/pkg/errors"
)

// Schedule is the publishing plan of future memos: a Markdown template plus a
// recurrence. A recurring plan clones a fresh memo each time it fires, so every
// published memo stays editable on its own.
//
// The recurrence is one of:
//   - Nothing recurring: the plan fires once, at StartTs, then retires,
//   - EveryNDays for day counts (every 1 day = daily),
//   - WeekdayMask with bit N set when the plan fires on weekday N (Sunday=1 …
//     Saturday=64).
//
// StartTs is the first fire; NextRunTs always holds the next due time (equal
// to StartTs until something fires). A row with RowStatus ARCHIVED has retired
// and fires no more.
type Schedule struct {
	ID        int32
	CreatedTs int64
	UpdatedTs int64
	CreatorID int32
	SpaceID   *int32
	RowStatus RowStatus
	Content   string
	// Visibility carries how the published memos appear.
	Visibility Visibility
	EveryNDays *int32
	// WeekdayMask holds one bit per weekday, Sunday=1 … Saturday=64.
	WeekdayMask *int32
	// StartTs is the first fire time; for a one-off plan it is the only fire.
	StartTs   int64
	NextRunTs int64
	// LastFiredTs is when the plan last published; nil before any fire.
	LastFiredTs        *int64
	LastCreatedMemoUID *string
}

type FindSchedule struct {
	ID        *int32
	UID       *string
	CreatorID *int32
	// DueBefore, when set, narrows to active schedules whose NextRunTs has passed.
	DueBefore *int64
	Limit     *int
	Offset    *int
}

type UpdateSchedule struct {
	ID                 int32
	Content            *string
	Visibility         *Visibility
	SpaceID            *int32
	ClearSpace         bool
	RowStatus          *RowStatus
	EveryNDays         *int32
	WeekdayMask        *int32
	StartTs            *int64
	ClearEveryNDays    bool
	ClearWeekdayMask   bool
	NextRunTs          *int64
	LastFiredTs        *int64
	SetLastFired       bool
	LastCreatedMemoUID *string
}

type DeleteSchedule struct {
	ID          int32
	ActorUserID int32
}

// CreateSchedule inserts a publishing plan.
func (s *Store) CreateSchedule(ctx context.Context, create *Schedule) (*Schedule, error) {
	if create == nil {
		return nil, errors.New("schedule is required")
	}
	if create.CreatorID <= 0 {
		return nil, errors.New("schedule creator is required")
	}
	return s.driver.CreateSchedule(ctx, create)
}

// ListSchedules lists publishing plans, the soonest next runs first.
func (s *Store) ListSchedules(ctx context.Context, find *FindSchedule) ([]*Schedule, error) {
	return s.driver.ListSchedules(ctx, find)
}

// GetSchedule returns one publishing plan.
func (s *Store) GetSchedule(ctx context.Context, find *FindSchedule) (*Schedule, error) {
	schedule, err := s.driver.GetSchedule(ctx, find)
	if err != nil {
		return nil, err
	}
	if schedule == nil {
		return nil, errors.New("schedule not found")
	}
	return schedule, nil
}

// UpdateSchedule applies field updates to a publishing plan.
func (s *Store) UpdateSchedule(ctx context.Context, update *UpdateSchedule) (*Schedule, error) {
	if update == nil || update.ID <= 0 {
		return nil, errors.New("schedule to update is required")
	}
	return s.driver.UpdateSchedule(ctx, update)
}

// DeleteSchedule removes a publishing plan.
func (s *Store) DeleteSchedule(ctx context.Context, delete *DeleteSchedule) error {
	if delete == nil || delete.ID <= 0 {
		return errors.New("schedule deletion is required")
	}
	if delete.ActorUserID <= 0 {
		return errors.New("schedule deletion requires the actor")
	}
	return s.driver.DeleteSchedule(ctx, delete)
}

// ListDueSchedules returns every active schedule whose next run has passed, so a
// single sweep can publish them all.
func (s *Store) ListDueSchedules(ctx context.Context, nowTs int64) ([]*Schedule, error) {
	return s.driver.ListSchedules(ctx, &FindSchedule{DueBefore: &nowTs})
}
