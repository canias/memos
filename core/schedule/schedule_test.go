package schedule

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidate(t *testing.T) {
	everyFive := int32(5)
	zero := int32(0)
	weekdays := int32(WeekdayMonday | WeekdayFriday)
	empty := int32(0)

	require.NoError(t, Validate(nil, nil)) // a one-off plan
	require.NoError(t, Validate(&everyFive, nil))
	require.NoError(t, Validate(nil, &weekdays))
	require.Error(t, Validate(&everyFive, &weekdays))
	require.Error(t, Validate(&zero, nil))
	require.Error(t, Validate(nil, &empty))
}

func TestNextRunAfter(t *testing.T) {
	// 2026-11-16 is Monday, all times UTC.
	day := func(mondayOffset int, hour int) int64 {
		return time.Date(2026, 11, 16+mondayOffset, hour, 0, 0, 0, time.UTC).Unix()
	}
	everyTwoDays := int32(2)
	weekdays := int32(WeekdayMonday | WeekdayFriday)

	tests := []struct {
		name        string
		startTs     int64
		everyNDays  *int32
		weekdayMask *int32
		afterTs     int64
		want        int64
		wantErr     bool
	}{
		{
			name:    "not yet due returns the start",
			startTs: day(3, 9), afterTs: day(1, 9), want: day(3, 9),
		},
		{
			name:    "one-off has no run after its fire",
			startTs: day(0, 9), afterTs: day(0, 9), wantErr: true,
		},
		{
			name:    "every two days skips the overdue span in one step",
			startTs: day(0, 9), everyNDays: &everyTwoDays, afterTs: day(3, 10), want: day(4, 9),
		},
		{
			name:    "weekdays continue on the next matching day",
			startTs: day(0, 9), weekdayMask: &weekdays, afterTs: day(0, 10), want: day(4, 9),
		},
		{
			name:    "weekdays pass a matched weekday whose fire already passed",
			startTs: day(0, 9), weekdayMask: &weekdays, afterTs: day(4, 12), want: day(7, 9),
		},
		{
			name:    "daily plans fire every day",
			startTs: day(0, 9), everyNDays: new(int32), wantErr: true, afterTs: day(0, 9),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NextRunAfter(tt.startTs, tt.everyNDays, tt.weekdayMask, tt.afterTs)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestWeekdayBits(t *testing.T) {
	assert.True(t, HasAnyWeekday(WeekdaySunday|WeekdaySaturday))
	assert.False(t, HasAnyWeekday(0))
	sunday := time.Date(2026, 11, 15, 0, 0, 0, 0, time.UTC)
	assert.Equal(t, int32(WeekdaySunday), int32(1<<int(sunday.Weekday())))
}

func TestIsOneOff(t *testing.T) {
	weekdays := int32(WeekdayMonday)
	assert.True(t, IsOneOff(nil, nil))
	assert.False(t, IsOneOff(new(int32), nil))
	assert.False(t, IsOneOff(nil, &weekdays))
}

func TestFirstRun(t *testing.T) {
	day := func(mondayOffset int, hour int) int64 {
		return time.Date(2026, 11, 16+mondayOffset, hour, 0, 0, 0, time.UTC).Unix()
	}
	weekdays := int32(WeekdayMonday | WeekdayFriday)

	// A weekday plan whose start lands on a Wednesday waits for Friday.
	assert.Equal(t, day(4, 9), FirstRun(day(2, 9), nil, &weekdays))
	// A start on a masked day fires that day.
	assert.Equal(t, day(4, 9), FirstRun(day(4, 9), nil, &weekdays))
	// Day counts and one-offs fire at the start.
	assert.Equal(t, day(2, 9), FirstRun(day(2, 9), new(int32), nil))
	assert.Equal(t, day(2, 9), FirstRun(day(2, 9), nil, nil))
}
