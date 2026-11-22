import { Button, Field, Input, Popover, Select } from "@usememos/ui";
import { CalendarClockIcon } from "lucide-react";
import { type FC, useState } from "react";
import { cn } from "@/lib/utils";
import { type Translations, useTranslate } from "@/utils/i18n";
import type { ScheduleDraft } from "../types";

interface Recurrence {
  kind: "once" | "everyDays" | "weekdays";
  everyNDays: number;
  weekdayMask: number;
}

const WEEKDAYS: { bit: number; label: Translations }[] = [
  { bit: 1 << 1, label: "weekday.monday" },
  { bit: 1 << 2, label: "weekday.tuesday" },
  { bit: 1 << 3, label: "weekday.wednesday" },
  { bit: 1 << 4, label: "weekday.thursday" },
  { bit: 1 << 5, label: "weekday.friday" },
  { bit: 1 << 6, label: "weekday.saturday" },
  { bit: 1 << 0, label: "weekday.sunday" },
];

const recurrenceOptions = (t: (key: Translations) => string): { value: Recurrence["kind"]; label: string }[] => [
  { value: "once", label: t("schedule.kind.once") },
  { value: "everyDays", label: t("schedule.kind.every-days") },
  { value: "weekdays", label: t("schedule.kind.weekdays") },
];

/** The first fire defaults an hour out. */
const defaultStartAt = () => new Date(Date.now() + 60 * 60 * 1000);

const pad = (n: number) => String(n).padStart(2, "0");
/** The local calendar day as `YYYY-MM-DD`, the value a date input shows. */
const toLocalDateValue = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** The local time as `HH:mm`, the value a time input shows. */
const toLocalTimeValue = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** A visible day count with − / + steppers; the count is editable and never drops below one. */
const EveryNDaysField: FC<{ value: number; onChange: (value: number) => void }> = ({ value, onChange }) => {
  const t = useTranslate();
  const clamp = (next: number) => onChange(Math.max(1, Math.min(365, Math.round(next) || 1)));
  return (
    <div className="flex items-center gap-2">
      <Button variant="neutral" size="sm" aria-label="−" onClick={() => clamp(value - 1)} disabled={value <= 1}>
        −
      </Button>
      <input
        type="number"
        min={1}
        max={365}
        value={value}
        aria-label={t("schedule.every-n-days", { count: value })}
        onChange={(event) => clamp(Number(event.target.value))}
        className="h-8 w-16 rounded-mu-md border border-mu-line bg-mu-surface text-center mu-body text-mu-text"
      />
      <span className="mu-body text-mu-text">{t("schedule.every-n-days", { count: value })}</span>
      <Button variant="neutral" size="sm" aria-label="+" onClick={() => clamp(value + 1)}>
        +
      </Button>
    </div>
  );
};

/**
 * Popover behind the toolbar's schedule affordance: the memo's date and, for a
 * recurrence, every N days or the weekdays it repeats on. Confirming stages the
 * values on the memo and closes the popover; the editor stays open until Save.
 */
export const ScheduleDraftMenu: FC<{ disabled: boolean; onConfirm: (draft: ScheduleDraft) => void }> = ({ disabled, onConfirm }) => {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [startAt, setStartAt] = useState<Date>(defaultStartAt);
  const [recurrence, setRecurrence] = useState<Recurrence>({ kind: "everyDays", everyNDays: 1, weekdayMask: 0 });

  const confirm = () => {
    onConfirm({
      startAt,
      ...(recurrence.kind === "everyDays" ? { everyNDays: recurrence.everyNDays } : {}),
      ...(recurrence.kind === "weekdays" ? { weekdayMask: recurrence.weekdayMask } : {}),
    });
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={<Button variant="ghost" size="sm" icon={<CalendarClockIcon />} disabled={disabled} aria-label={t("schedule.title")} />}
      />
      <Popover.Popup align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <Field.Root size="md">
            <Field.Label>{t("schedule.start")}</Field.Label>
            <div className="grid grid-cols-[1fr_7rem] items-end gap-2">
              <Input
                type="date"
                aria-label={t("schedule.start")}
                value={toLocalDateValue(startAt)}
                onChange={(event) => {
                  const next = new Date(`${event.target.value}T${toLocalTimeValue(startAt)}`);
                  if (!Number.isNaN(next.getTime())) setStartAt(next);
                }}
                className="w-full"
              />
              <div className="flex flex-col gap-1">
                <span className="mu-caption text-mu-text-secondary">{t("schedule.time")}</span>
                <Input
                  type="time"
                  aria-label={t("schedule.time")}
                  value={toLocalTimeValue(startAt)}
                  onChange={(event) => {
                    const next = new Date(`${toLocalDateValue(startAt)}T${event.target.value}`);
                    if (!Number.isNaN(next.getTime())) setStartAt(next);
                  }}
                  className="w-full"
                />
              </div>
            </div>
          </Field.Root>
          <Select.Root
            items={recurrenceOptions(t)}
            value={recurrence.kind}
            onValueChange={(value) => setRecurrence((current) => ({ ...current, kind: value as Recurrence["kind"] }))}
          >
            <Select.Trigger className="w-full">
              <Select.Value>{recurrenceOptions(t).find((option) => option.value === recurrence.kind)?.label}</Select.Value>
            </Select.Trigger>
            <Select.Popup>
              {recurrenceOptions(t).map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Root>

          {recurrence.kind === "everyDays" && (
            <EveryNDaysField
              value={recurrence.everyNDays}
              onChange={(everyNDays) => setRecurrence((current) => ({ ...current, everyNDays }))}
            />
          )}

          {recurrence.kind === "weekdays" && (
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((weekday) => (
                <button
                  key={weekday.bit}
                  type="button"
                  aria-pressed={(recurrence.weekdayMask & weekday.bit) !== 0}
                  onClick={() => setRecurrence((current) => ({ ...current, weekdayMask: current.weekdayMask ^ weekday.bit }))}
                  className={cn(
                    "mu-caption rounded-mu-md border px-2 py-1",
                    (recurrence.weekdayMask & weekday.bit) !== 0
                      ? "border-mu-line bg-mu-hover text-mu-text"
                      : "border-transparent text-mu-text-secondary hover:bg-mu-hover/60",
                  )}
                >
                  {t(weekday.label)}
                </button>
              ))}
            </div>
          )}

          <Button
            variant="primary"
            className="self-start"
            disabled={recurrence.kind === "weekdays" && recurrence.weekdayMask === 0}
            onClick={confirm}
          >
            {t("schedule.set-date")}
          </Button>
        </div>
      </Popover.Popup>
    </Popover.Root>
  );
};

export default ScheduleDraftMenu;
