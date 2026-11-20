package api

import (
	"context"
	"strconv"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	core "github.com/usememos/memos/core/schedule"
	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

// convertScheduleToResponse builds the API's Schedule from the stored row; the
// owner's name gives the resource name its path.
func (s *APIService) convertScheduleToResponse(ctx context.Context, user *store.User, schedule *store.Schedule) (*apipb.Schedule, error) {
	response := &apipb.Schedule{
		Name:       buildScheduleName(user.Username, formatScheduleID(schedule.ID)),
		Content:    schedule.Content,
		Visibility: convertVisibilityFromStore(schedule.Visibility),
		NextRun:    timestamppb.New(time.Unix(schedule.NextRunTs, 0)),
		CreateTime: timestamppb.New(time.Unix(schedule.CreatedTs, 0)),
		UpdateTime: timestamppb.New(time.Unix(schedule.UpdatedTs, 0)),
	}
	if schedule.EveryNDays != nil {
		response.EveryNDays = schedule.EveryNDays
	}
	if schedule.WeekdayMask != nil {
		response.WeekdayMask = schedule.WeekdayMask
	}
	response.StartAt = timestamppb.New(time.Unix(schedule.StartTs, 0))
	if schedule.LastFiredTs != nil {
		response.LastFired = timestamppb.New(time.Unix(*schedule.LastFiredTs, 0))
	}
	if schedule.LastCreatedMemoUID != nil && *schedule.LastCreatedMemoUID != "" {
		lastMemoName := buildMemoName(*schedule.LastCreatedMemoUID)
		response.LastCreatedMemo = &lastMemoName
	}
	if schedule.SpaceID != nil {
		spaces, err := s.Store.ListSpaces(ctx, &store.FindSpace{ID: schedule.SpaceID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to look up the schedule's space")
		}
		if len(spaces) > 0 {
			response.Space = buildSpaceName(spaces[0].UID)
		}
	}
	return response, nil
}

// convertScheduleRecurrenceToStore reads the plan's recurrence and validates it;
// nil rule pointers mean the plan is a one-off.
func convertScheduleRecurrenceToStore(plan *apipb.Schedule) (*int32, *int32, error) {
	everyNDaysPtr := plan.EveryNDays
	weekdayMaskPtr := plan.WeekdayMask
	if err := core.Validate(everyNDaysPtr, weekdayMaskPtr); err != nil {
		return nil, nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}
	return everyNDaysPtr, weekdayMaskPtr, nil
}

func formatScheduleID(id int32) string {
	return strconv.FormatInt(int64(id), 10)
}
