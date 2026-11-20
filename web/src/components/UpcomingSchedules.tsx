import { Button } from "@usememos/ui";
import { RepeatIcon, TrashIcon } from "lucide-react";
import { type FC } from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import { type Schedule, scheduleNextRunDate, useDeleteSchedule, useScheduleList } from "@/hooks/useScheduleQueries";
import { showErrorToast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";

const formatDateTime = (date: Date, locale: string): string =>
  date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const isRecurring = (schedule: Schedule): boolean => schedule.everyNDays != null || schedule.weekdayMask != null;

const UpcomingRow: FC<{ schedule: Schedule; locale: string }> = ({ schedule, locale }) => {
  const t = useTranslate();
  const deleteSchedule = useDeleteSchedule();
  const nextRun = scheduleNextRunDate(schedule);
  const preview = schedule.content.length > 96 ? `${schedule.content.slice(0, 96)}…` : schedule.content;

  return (
    <div className="flex items-start justify-between gap-2 rounded-mu-lg border border-mu-edge bg-mu-surface px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="mu-caption inline-flex items-center gap-1.5 text-mu-text-secondary">
          {isRecurring(schedule) && <RepeatIcon className="mu-icon-xs" aria-label={t("schedule.recurring")} />}
          <span>
            {t("schedule.next-run")} {nextRun && formatDateTime(nextRun, locale)}
          </span>
        </p>
        <p className="mu-body text-mu-text whitespace-pre-wrap">{preview}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon={<TrashIcon />}
        aria-label={t("schedule.delete")}
        disabled={deleteSchedule.isPending}
        onClick={() =>
          deleteSchedule.mutate(schedule.name, {
            onError: () => showErrorToast(t("schedule.delete-failed")),
          })
        }
      />
    </div>
  );
};

/**
 * The publishing plans that will produce memos on their own: each row names its
 * recurrence and its next fire. The section only shows on the signed-in user's own home.
 */
const UpcomingSchedules: FC = () => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const { data: schedules } = useScheduleList();
  const locale = navigator.language;

  if (!currentUser || !schedules || schedules.length === 0) {
    return null;
  }

  return (
    <section data-testid="upcoming-schedules" className="mb-2 rounded-mu-xl border border-mu-edge bg-mu-surface p-3">
      <p className="mu-label text-mu-text-secondary mb-2">{t("schedule.upcoming")}</p>
      <div className="flex flex-col gap-2">
        {schedules.map((schedule) => (
          <UpcomingRow key={schedule.name} schedule={schedule} locale={locale} />
        ))}
      </div>
      <p className="mu-caption text-mu-text-secondary mt-2">{t("schedule.upcoming-hint")}</p>
    </section>
  );
};

export default UpcomingSchedules;
