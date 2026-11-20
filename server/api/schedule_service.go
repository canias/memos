package api

import (
	"context"
	"log/slog"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/pkg/errors"

	core "github.com/usememos/memos/core/schedule"
	"github.com/usememos/memos/internal/ratelimit"
	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

// CreateSchedule creates a publishing plan owned by the authenticated user.
func (s *APIService) CreateSchedule(ctx context.Context, request *apipb.CreateScheduleRequest) (*apipb.Schedule, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if err := s.throttleAndCharge(ratelimit.ScopeWriteUser, userKey(user.ID), 1); err != nil {
		return nil, err
	}
	if _, err := s.assertScheduleOwner(user, request.GetParent()); err != nil {
		return nil, err
	}
	if request.GetSchedule() == nil {
		return nil, status.Errorf(codes.InvalidArgument, "schedule is required")
	}
	plan := request.GetSchedule()
	if plan.GetStartAt() == nil {
		return nil, status.Errorf(codes.InvalidArgument, "start_at is required")
	}
	if plan.GetVisibility() == apipb.Visibility_VISIBILITY_UNSPECIFIED {
		plan.Visibility = apipb.Visibility_PRIVATE
	}
	visibility, err := validateCreateMemoVisibility(plan.GetVisibility())
	if err != nil {
		return nil, err
	}
	ruleEveryNDays, ruleWeekdayMask, err := convertScheduleRecurrenceToStore(plan)
	if err != nil {
		return nil, err
	}
	var spaceID *int32
	if plan.GetSpace() != "" {
		if spaceID, err = s.resolveScheduleSpace(ctx, user, plan.GetSpace()); err != nil {
			return nil, err
		}
	}

	startTs := plan.GetStartAt().AsTime().Unix()
	created, err := s.Store.CreateSchedule(ctx, &store.Schedule{
		CreatorID:   user.ID,
		SpaceID:     spaceID,
		RowStatus:   store.Normal,
		Content:     plan.GetContent(),
		Visibility:  visibility,
		EveryNDays:  ruleEveryNDays,
		WeekdayMask: ruleWeekdayMask,
		StartTs:     startTs,
		NextRunTs:   core.FirstRun(startTs, ruleEveryNDays, ruleWeekdayMask),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create schedule")
	}
	return s.convertScheduleToResponse(ctx, user, created)
}

// GetSchedule gets a schedule; the caller must own it.
func (s *APIService) GetSchedule(ctx context.Context, request *apipb.GetScheduleRequest) (*apipb.Schedule, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	scheduleID, err := s.scheduleIDForCaller(user, request.GetName())
	if err != nil {
		return nil, err
	}
	schedule, err := s.Store.GetSchedule(ctx, &store.FindSchedule{ID: scheduleID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get schedule")
	}
	if schedule == nil {
		return nil, status.Errorf(codes.NotFound, "schedule not found")
	}
	return s.convertScheduleToResponse(ctx, user, schedule)
}

// ListSchedules lists the caller's schedules, the soonest next runs first.
func (s *APIService) ListSchedules(ctx context.Context, request *apipb.ListSchedulesRequest) (*apipb.ListSchedulesResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if _, err := s.assertScheduleOwner(user, request.GetParent()); err != nil {
		return nil, err
	}

	creatorID := user.ID
	schedules, err := s.Store.ListSchedules(ctx, &store.FindSchedule{CreatorID: &creatorID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list schedules")
	}
	response := &apipb.ListSchedulesResponse{}
	for _, schedule := range schedules {
		converted, err := s.convertScheduleToResponse(ctx, user, schedule)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to convert schedule")
		}
		response.Schedules = append(response.Schedules, converted)
	}
	return response, nil
}

// UpdateSchedule updates a schedule's fields and recomputes its next run when
// the recurrence changes.
func (s *APIService) UpdateSchedule(ctx context.Context, request *apipb.UpdateScheduleRequest) (*apipb.Schedule, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if err := s.throttleAndCharge(ratelimit.ScopeWriteUser, userKey(user.ID), 1); err != nil {
		return nil, err
	}
	plan := request.GetSchedule()
	if plan == nil {
		return nil, status.Errorf(codes.InvalidArgument, "schedule is required")
	}
	scheduleID, err := s.scheduleIDForCaller(user, plan.GetName())
	if err != nil {
		return nil, err
	}
	existing, err := s.Store.GetSchedule(ctx, &store.FindSchedule{ID: scheduleID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get schedule")
	}
	if existing == nil {
		return nil, status.Errorf(codes.NotFound, "schedule not found")
	}

	update := &store.UpdateSchedule{ID: existing.ID}
	if request.GetUpdateMask() == nil {
		return nil, status.Errorf(codes.InvalidArgument, "update_mask is required")
	}
	ruleChanged := false
	for _, path := range request.GetUpdateMask().GetPaths() {
		switch path {
		case "content":
			update.Content = &plan.Content
		case "visibility":
			visibility, err := validateUpdateMemoVisibility(plan.GetVisibility())
			if err != nil {
				return nil, err
			}
			update.Visibility = &visibility
		case "space":
			if plan.GetSpace() == "" {
				update.ClearSpace = true
			} else {
				var spaceID *int32
				if spaceID, err = s.resolveScheduleSpace(ctx, user, plan.GetSpace()); err != nil {
					return nil, err
				}
				update.SpaceID = spaceID
			}
		case "start_at", "every_n_days", "weekday_mask":
			ruleChanged = true
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update path: %s", path)
		}
	}
	if ruleChanged {
		ruleEveryNDays, ruleWeekdayMask, err := convertScheduleRecurrenceToStore(plan)
		if err != nil {
			return nil, err
		}
		update.ClearEveryNDays = plan.EveryNDays == nil
		update.ClearWeekdayMask = plan.WeekdayMask == nil
		update.EveryNDays = ruleEveryNDays
		update.WeekdayMask = ruleWeekdayMask
		if plan.GetStartAt() != nil {
			startTs := plan.GetStartAt().AsTime().Unix()
			update.StartTs = &startTs
			nextRun := core.FirstRun(startTs, ruleEveryNDays, ruleWeekdayMask)
			update.NextRunTs = &nextRun
		}
	}

	updated, err := s.Store.UpdateSchedule(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update schedule")
	}
	return s.convertScheduleToResponse(ctx, user, updated)
}

// DeleteSchedule removes a schedule. Published memos stay.
func (s *APIService) DeleteSchedule(ctx context.Context, request *apipb.DeleteScheduleRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if err := s.throttleAndCharge(ratelimit.ScopeWriteUser, userKey(user.ID), 1); err != nil {
		return nil, err
	}
	scheduleID, err := s.scheduleIDForCaller(user, request.GetName())
	if err != nil {
		return nil, err
	}
	existing, err := s.Store.GetSchedule(ctx, &store.FindSchedule{ID: scheduleID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get schedule")
	}
	if existing == nil {
		return nil, status.Errorf(codes.NotFound, "schedule not found")
	}
	if err := s.Store.DeleteSchedule(ctx, &store.DeleteSchedule{ID: existing.ID, ActorUserID: user.ID}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete schedule")
	}
	return &emptypb.Empty{}, nil
}

// scheduleIDForCaller parses a Schedule resource name and requires it to name the caller.
func (*APIService) scheduleIDForCaller(user *store.User, name string) (*int32, error) {
	username, scheduleToken, err := ExtractScheduleOwnerTokensFromName(name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid schedule name: %v", err)
	}
	if username != user.Username {
		return nil, status.Errorf(codes.NotFound, "schedule not found")
	}
	scheduleID, err := parseInt32(scheduleToken)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid schedule name: %v", err)
	}
	return &scheduleID, nil
}

// assertScheduleOwner checks a CreateSchedule's parent names the caller.
func (*APIService) assertScheduleOwner(user *store.User, parent string) (*store.User, error) {
	parts, err := GetNameParentTokens(parent, UserNamePrefix)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid parent: %v", err)
	}
	if parts[0] != user.Username {
		return nil, status.Errorf(codes.InvalidArgument, "parent must be the caller's user")
	}
	return user, nil
}

// resolveScheduleSpace converts a Space resource name into a space ID the plan
// may place its memos in.
func (s *APIService) resolveScheduleSpace(ctx context.Context, user *store.User, spaceName string) (*int32, error) {
	spaceUID, err := ExtractSpaceUIDFromName(spaceName)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid space: %v", err)
	}
	memberID := user.ID
	spaces, err := s.Store.ListSpaces(ctx, &store.FindSpace{UID: &spaceUID, MemberUserID: &memberID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to look up the space")
	}
	if len(spaces) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "space not found: %s", spaceName)
	}
	spaceID := spaces[0].ID
	return &spaceID, nil
}

// CreateMemoFromSchedule publishes the memo a due schedule produces: a fresh,
// ordinary memo cloned from the template, dated at its due moment.
func (s *APIService) CreateMemoFromSchedule(ctx context.Context, schedule *store.Schedule) (*store.Memo, error) {
	user, err := s.Store.GetUser(ctx, &store.FindUser{ID: &schedule.CreatorID})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get the schedule's owner")
	}
	if user == nil {
		return nil, errors.New("the schedule's owner no longer exists")
	}

	input := &apipb.Memo{
		Content:    schedule.Content,
		Visibility: convertVisibilityFromStore(schedule.Visibility),
		CreateTime: timestamppb.New(time.Unix(schedule.NextRunTs, 0)),
	}
	if schedule.SpaceID != nil {
		spaces, err := s.Store.ListSpaces(ctx, &store.FindSpace{ID: schedule.SpaceID})
		if err != nil {
			return nil, errors.Wrap(err, "failed to look up the schedule's space")
		}
		if len(spaces) == 0 {
			return nil, errors.New("the schedule's space no longer exists")
		}
		input.Space = new(buildSpaceName(spaces[0].UID))
	}
	memoUID, err := ValidateAndGenerateUID("")
	if err != nil {
		return nil, err
	}
	prepared, err := s.prepareMemoCreate(ctx, user, input, memoUID)
	if err != nil {
		return nil, err
	}
	if err := s.checkMemoQuota(ctx, user.ID); err != nil {
		return nil, err
	}
	if err := s.createMemoWithMutation(ctx, user, prepared.memo, nil, prepared.attachments, prepared.requiredAttachmentIDs, prepared.referenceRelations); err != nil {
		return nil, mapMemoCreateError(err, memoUID, "failed to publish the scheduled memo")
	}
	return prepared.memo, nil
}

// PublishMemoChanged tells connected clients a memo changed; the sweep uses it
// after publishing from templates.
func (s *APIService) PublishMemoChanged() {
	s.SSEHub.publishMemoChanged()
}

// RunScheduleSweep publishes every due schedule once: each due plan clones a
// fresh memo from its template, then advances (or retires a one-off). The
// server ticks this once a minute and lets controllers refresh on changes.
func (s *APIService) RunScheduleSweep(ctx context.Context) []error {
	due, err := s.Store.ListDueSchedules(ctx, time.Now().Unix())
	if err != nil {
		return []error{errors.Wrap(err, "failed to list due schedules")}
	}
	var errs []error
	for _, schedule := range due {
		if err := s.publishDueSchedule(schedule); err != nil {
			slog.Error("failed to publish a due schedule", slog.Int("id", int(schedule.ID)), slog.String("error", err.Error()))
			errs = append(errs, err)
			continue
		}
	}
	return errs
}

// publishDueSchedule fires one due plan in the scheduler sweep: it clones a
// fresh memo from the template and retires or advances the plan.
func (s *APIService) publishDueSchedule(schedule *store.Schedule) error {
	ctx := context.Background()
	memo, err := s.CreateMemoFromSchedule(ctx, schedule)
	if err != nil {
		return errors.Wrap(err, "failed to publish")
	}
	firedAtSec := time.Now().Unix()
	if core.IsOneOff(schedule.EveryNDays, schedule.WeekdayMask) {
		retired := store.Archived
		stopped := int64(0)
		_, err := s.Store.UpdateSchedule(ctx, &store.UpdateSchedule{
			ID:                 schedule.ID,
			RowStatus:          &retired,
			NextRunTs:          &stopped,
			SetLastFired:       true,
			LastFiredTs:        &firedAtSec,
			LastCreatedMemoUID: &memo.UID,
		})
		if err != nil {
			slog.Error("failed to retire a fired one-off schedule", slog.Int("id", int(schedule.ID)), slog.String("error", err.Error()))
			return errors.Wrap(err, "failed to retire the schedule")
		}
		return nil
	}
	nextRun, err := core.NextRunAfter(schedule.StartTs, schedule.EveryNDays, schedule.WeekdayMask, time.Now().Unix())
	if err != nil {
		return errors.Wrap(err, "failed to advance the schedule")
	}
	_, err = s.Store.UpdateSchedule(ctx, &store.UpdateSchedule{
		ID:                 schedule.ID,
		NextRunTs:          &nextRun,
		SetLastFired:       true,
		LastFiredTs:        &firedAtSec,
		LastCreatedMemoUID: &memo.UID,
	})
	if err != nil {
		return errors.Wrap(err, "failed to advance the schedule")
	}
	return nil
}
