package api

import (
	core "github.com/usememos/memos/core/schedule"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// recurrenceRollover is the outcome of a memo finishing one occurrence: the date
// the memo moves to.
type recurrenceRollover struct {
	CreatedTs int64
}

// reanchorRecurrence moves a recurring memo's next occurrence to the first one after
// its date `createdTs`, keeping the rule. A memo dated in the future keeps its date as
// its first occurrence. The memo's payload is updated in place.
func reanchorRecurrence(memo *store.Memo, createdTs int64) error {
	recurrence := memo.Payload.Recurrence
	nextRun, err := core.NextRunAfter(createdTs, recurrence.EveryNDays, recurrence.WeekdayMask, createdTs-1)
	if err != nil {
		return err
	}
	recurrence.NextRunTs = nextRun
	return nil
}

// rollRecurringMemo applies the completion rule to a memo that carries a recurrence.
// When every task in its content is done it unchecks every task, advances the
// recurrence to its next occurrence, and returns the rollover so the caller can move
// the memo's date. It returns nil when the memo is not recurring or not complete.
// The memo's content and payload are updated in place.
func rollRecurringMemo(memo *store.Memo) *recurrenceRollover {
	if memo.Payload == nil || memo.Payload.Recurrence == nil {
		return nil
	}
	if !core.AllTasksDone(memo.Content) {
		return nil
	}
	recurrence := memo.Payload.Recurrence
	var everyNDays *int32
	var weekdayMask *int32
	if recurrence.EveryNDays != nil {
		v := *recurrence.EveryNDays
		everyNDays = &v
	}
	if recurrence.WeekdayMask != nil {
		v := *recurrence.WeekdayMask
		weekdayMask = &v
	}
	// The occurrence the memo just completed is recurrence.NextRunTs; advance past it.
	nextRun, err := core.AdvanceMemoRecurrence(recurrence.NextRunTs, everyNDays, weekdayMask, recurrence.NextRunTs)
	if err != nil {
		return nil
	}
	memo.Content = core.ResetTasks(memo.Content)
	memo.Payload.Recurrence = &storepb.MemoPayload_Recurrence{
		EveryNDays:  everyNDays,
		WeekdayMask: weekdayMask,
		NextRunTs:   nextRun,
	}
	return &recurrenceRollover{CreatedTs: nextRun}
}
