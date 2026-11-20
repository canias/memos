import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { FieldMaskSchema, timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scheduleServiceClient } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";
import { type Schedule, ScheduleSchema } from "@/types/proto/api/schedule_service_pb";

/**
 * The user's publishing plans, the soonest next runs first. A plan with a
 * recurrence (every N days or weekdays) keeps publishing clones of its template;
 * a one-off plan retires after its single fire.
 */
export const useScheduleList = () => {
  const currentUser = useCurrentUser();
  const name = currentUser?.name;
  return useQuery({
    queryKey: ["user-schedules", name],
    enabled: Boolean(name),
    queryFn: async () => {
      const response = await scheduleServiceClient.listSchedules({ parent: name as string });
      return response.schedules;
    },
  });
};

/** Creates a publishing plan from a template plus its first fire and recurrence. */
export const useCreateSchedule = () => {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  return useMutation({
    mutationFn: async (request: MessageInitShape<typeof ScheduleSchema>) => {
      const name = currentUser?.name;
      if (!name) throw new Error("user not authenticated");
      return scheduleServiceClient.createSchedule({ parent: name, schedule: request });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-schedules"] });
    },
  });
};

const scheduleKey = (schedule: Schedule | undefined) => ["user-schedules", schedule?.name];

/**
 * Updates a plan; when the recurrence or start changes the server recomputes
 * the next run.
 */
export const useUpdateSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ schedule, updateMask }: { schedule: Schedule; updateMask: string[] }) => {
      return scheduleServiceClient.updateSchedule({
        schedule: create(ScheduleSchema, schedule),
        updateMask: create(FieldMaskSchema, { paths: updateMask }),
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(scheduleKey(updated), updated);
      queryClient.invalidateQueries({ queryKey: ["user-schedules"] });
    },
  });
};

/** Deletes a plan; the memos it already published stay. */
export const useDeleteSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => scheduleServiceClient.deleteSchedule({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-schedules"] });
    },
  });
};

export type { Schedule };

export const scheduleNextRunDate = (schedule: Schedule): Date | undefined =>
  schedule.nextRun ? timestampDate(schedule.nextRun) : undefined;

export const scheduleStartDate = (schedule: Schedule): Date | undefined => (schedule.startAt ? timestampDate(schedule.startAt) : undefined);

export const scheduleStartTimestamp = (date: Date) => timestampFromDate(date);
