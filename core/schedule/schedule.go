// Package schedule holds the calendar rules behind recurring memos: when a
// recurrence fires next. The math is pure; the server applies it on save.
package schedule

import (
	"time"

	"github.com/pkg/errors"
)

// Weekday bits: bit N set when the plan fires on that weekday.
const (
	WeekdaySunday    = 1 << 0
	WeekdayMonday    = 1 << 1
	WeekdayTuesday   = 1 << 2
	WeekdayWednesday = 1 << 3
	WeekdayThursday  = 1 << 4
	WeekdayFriday    = 1 << 5
	WeekdaySaturday  = 1 << 6
)

// WeekdayAll covers every weekday, matching a daily plan.
const WeekdayAll = WeekdaySunday | WeekdayMonday | WeekdayTuesday | WeekdayWednesday | WeekdayThursday | WeekdayFriday | WeekdaySaturday

// HasAnyWeekday reports whether the mask selects at least one weekday.
func HasAnyWeekday(mask int32) bool {
	return mask&WeekdayAll != 0
}

// IsOneOff reports whether a plan fires once and retires: neither recurrence
// form is set, so it publishes at its start and has no run after.
func IsOneOff(everyNDays *int32, weekdayMask *int32) bool {
	return everyNDays == nil && weekdayMask == nil
}

// Validate checks a plan's recurrence shape.
func Validate(everyNDays *int32, weekdayMask *int32) error {
	if everyNDays != nil && weekdayMask != nil {
		return errors.New("choose either every N days or weekdays, not both")
	}
	if everyNDays != nil && *everyNDays < 1 {
		return errors.New("every N days needs N of at least 1")
	}
	if weekdayMask != nil && !HasAnyWeekday(*weekdayMask) {
		return errors.New("weekday recurrence needs at least one weekday")
	}
	return nil
}

// FirstRun returns the plan's first fire at or after `startTs`: the start
// itself, except that a weekday plan waits for the first masked day.
func FirstRun(startTs int64, _ *int32, weekdayMask *int32) int64 {
	next := startTs
	for range 8 {
		weekday := time.Unix(next, 0).UTC().Weekday()
		if weekdayMask == nil || *weekdayMask&(1<<int(weekday)) != 0 {
			return next
		}
		next += 24 * 3600
	}
	return startTs
}

// NextRunAfter returns the plan's next run strictly after `afterTs` (a Unix
// second), given its first fire at `startTs`. Day counts and weekday walks step
// whole days, so every run keeps the time of day `startTs` carries. The caller
// converts a member's local calendar into these seconds.
func NextRunAfter(startTs int64, everyNDays *int32, weekdayMask *int32, afterTs int64) (int64, error) {
	if startTs > afterTs {
		return startTs, nil
	}
	switch {
	case everyNDays != nil && weekdayMask != nil:
		return 0, errors.New("choose either every N days or weekdays, not both")
	case everyNDays != nil && *everyNDays >= 1:
		next := startTs
		step := int64(*everyNDays) * 24 * 3600
		for next <= afterTs {
			next += step
		}
		return next, nil
	case weekdayMask != nil && HasAnyWeekday(*weekdayMask):
		// Walk whole days forward until the candidate is after `afterTs` and lands
		// on a masked weekday. Some masked weekday always follows within a week.
		next := startTs
		for range 8 {
			weekday := time.Unix(next, 0).UTC().Weekday()
			if next > afterTs && *weekdayMask&(1<<int(weekday)) != 0 {
				break
			}
			next += 24 * 3600
		}
		if next <= afterTs {
			return 0, errors.New("weekday schedule has no matching day within a week")
		}
		return next, nil
	default:
		return 0, errors.New("one-off schedule has no run after its fire")
	}
}

// DayBoundary returns the local day's [start, end) as Unix seconds.
func DayBoundary(local *time.Location, day time.Time) (int64, int64) {
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, local)
	return start.Unix(), start.AddDate(0, 0, 1).Unix()
}
