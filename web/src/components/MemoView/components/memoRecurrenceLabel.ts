import type { Memo_MemoRecurrence } from "@/types/proto/api/memo_service_pb";
import type { Translations } from "@/utils/i18n";

type TypedTranslate = (key: Translations, params?: Record<string, unknown>) => string;

const WEEKDAY_KEYS = [
  "weekday.sunday",
  "weekday.monday",
  "weekday.tuesday",
  "weekday.wednesday",
  "weekday.thursday",
  "weekday.friday",
  "weekday.saturday",
] as const satisfies readonly Translations[];

/**
 * The short recurrence label shown beside a recurring memo's date: "Every 3 day(s)",
 * or the masked weekdays such as "Mon, Wed". Returns "" when the rule is empty.
 */
export const recurrenceLabel = (recurrence: Memo_MemoRecurrence, t: TypedTranslate): string => {
  if (recurrence.everyNDays !== undefined) {
    return t("schedule.every-n-days", { count: recurrence.everyNDays });
  }
  if (recurrence.weekdayMask !== undefined) {
    return WEEKDAY_KEYS.filter((_, bit) => (recurrence.weekdayMask! & (1 << bit)) !== 0)
      .map((key) => t(key))
      .join(", ");
  }
  return "";
};
