package api

import (
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	core "github.com/usememos/memos/core/schedule"
	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
)

// recurrenceFromInput converts a memo's requested recurrence into the stored form,
// anchored to the memo's date. A nil input means the memo is not recurring. The
// memo's date is its next occurrence, so NextRunTs starts at createdTs.
func recurrenceFromInput(input *apipb.Memo_MemoRecurrence, createdTs int64) (*storepb.MemoPayload_Recurrence, error) {
	if input == nil {
		return nil, nil
	}
	if err := core.Validate(input.EveryNDays, input.WeekdayMask); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid recurrence: %v", err)
	}
	return &storepb.MemoPayload_Recurrence{
		EveryNDays:  input.EveryNDays,
		WeekdayMask: input.WeekdayMask,
		NextRunTs:   createdTs,
	}, nil
}
