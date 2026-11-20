import { buttonClasses, Field, Popover, Select, Separator, Switch } from "@usememos/ui";
import dayjs from "dayjs";
import type { LucideIcon } from "lucide-react";
import { CalendarIcon, CheckCircleIcon, CodeIcon, FilterIcon, ImageIcon, LinkIcon, MapPinIcon, PaperclipIcon } from "lucide-react";
import { type FC } from "react";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { type FilterFactor, type MemoFilter, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/memo_service_pb";
import { type Translations, useTranslate } from "@/utils/i18n";

interface FacetOption {
  factor: FilterFactor;
  label: Translations;
  icon: LucideIcon;
}

/** The quick facets: anything the memo list can narrow by with one toggle. */
const PROPERTY_FACETS: FacetOption[] = [
  { factor: "property.hasTaskList", label: "memo.filters.has-task-list", icon: CheckCircleIcon },
  { factor: "property.hasLink", label: "memo.filters.has-link", icon: LinkIcon },
  { factor: "property.hasCode", label: "memo.filters.has-code", icon: CodeIcon },
  { factor: "property.hasImage", label: "memo.filters.has-image", icon: ImageIcon },
  { factor: "property.hasAttachments", label: "memo.filters.has-attachments", icon: PaperclipIcon },
  { factor: "property.hasLocation", label: "memo.filters.has-location", icon: MapPinIcon },
];

const visibilityItems = (t: ReturnType<typeof useTranslate>): Record<string, string> => ({
  [Visibility.PRIVATE]: t("memo.visibility.private"),
  [Visibility.PROTECTED]: t("memo.visibility.protected"),
  [Visibility.PUBLIC]: t("memo.visibility.public"),
});

const hasFilter = (filters: MemoFilter[], factor: FilterFactor): boolean => filters.some((filter) => filter.factor === factor);

const toggleFilter = (filters: MemoFilter[], factor: FilterFactor, value: string): MemoFilter[] =>
  hasFilter(filters, factor) ? filters.filter((filter) => filter.factor !== factor) : [...filters, { factor, value }];

const FacetToggle: FC<{ option: FacetOption; active: boolean; onToggle: () => void }> = ({
  option: { icon: Icon, label },
  active,
  onToggle,
}) => {
  const t = useTranslate();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-mu-md border px-2.5 mu-caption transition-colors",
        active ? "border-mu-line bg-mu-hover text-mu-text" : "border-transparent text-mu-text-secondary hover:bg-mu-hover/60",
      )}
    >
      <Icon className="mu-icon-sm" />
      {t(label)}
    </button>
  );
};

/**
 * One popover for the feed's handy filters: a day, pinned, the audience and the content
 * facets. Everything writes the same URL-carried filter factors the chips show, so the
 * result is shareable and removable chip by chip.
 */
const MemoFilterPopover = ({ className }: { className?: string }) => {
  const t = useTranslate();
  const { filters, setFilters } = useMemoFilterContext();
  const { memoFilterMenuOpen, setMemoFilterMenuOpen } = useAppSidebar();

  // The trigger click and the `f` hotkey share one open flag: the hotkey sets it from
  // the context, and every close or click reports back through the same setter.
  const apply = (next: MemoFilter[]) => setFilters(next);
  const activeCount = filters.filter(
    (filter) => filter.factor !== "contentSearch" && filter.factor !== "celSearch" && filter.factor !== "tagSearch",
  ).length;

  const dayFilter = filters.find((filter) => filter.factor === "displayTime");

  return (
    <Popover.Root open={memoFilterMenuOpen} onOpenChange={(open) => setMemoFilterMenuOpen(open)}>
      <Popover.Trigger
        render={
          <button
            type="button"
            aria-label={t("memo.filters.title")}
            className={cn(buttonClasses({ variant: "ghost", iconOnly: true }), activeCount > 0 && "text-mu-text bg-mu-hover", className)}
          >
            <FilterIcon className="mu-icon" />
          </button>
        }
      />
      <Popover.Popup align="start" className="w-72">
        <div className="flex flex-col gap-3">
          <Field.Root size="md">
            <Field.Label>{t("common.created-at")}</Field.Label>
            <div className="flex items-center gap-2">
              <CalendarIcon className="mu-icon-sm text-mu-text-secondary" />
              <input
                type="date"
                value={dayFilter && dayjs(dayFilter.value, "YYYY-MM-DD").isValid() ? dayFilter.value : ""}
                onChange={(event) => {
                  const value = event.target.value;
                  const withoutDay = filters.filter((filter) => filter.factor !== "displayTime");
                  apply(value ? [...withoutDay, { factor: "displayTime", value }] : withoutDay);
                }}
                className="h-8 w-full rounded-mu-md border border-mu-line bg-mu-surface px-2 mu-caption text-mu-text"
              />
              {dayFilter && (
                <button
                  type="button"
                  onClick={() => apply(filters.filter((filter) => filter.factor !== "displayTime"))}
                  className="mu-caption text-mu-text-secondary hover:underline"
                >
                  {t("memo.filters.remove")}
                </button>
              )}
            </div>
          </Field.Root>

          <Field.Root orientation="horizontal" size="md">
            <Field.Label>{t("memo.pinned")}</Field.Label>
            <Switch checked={hasFilter(filters, "pinned")} onCheckedChange={() => apply(toggleFilter(filters, "pinned", "true"))} />
          </Field.Root>

          <Field.Root size="md">
            <Field.Label>{t("memo.visibility")}</Field.Label>
            <Select.Root
              items={visibilityItems(t)}
              value={filters.find((item) => item.factor === "visibility")?.value ?? ""}
              onValueChange={(value) => {
                const withoutVisibility = filters.filter((filter) => filter.factor !== "visibility");
                apply(value ? [...withoutVisibility, { factor: "visibility", value }] : withoutVisibility);
              }}
            >
              <Select.Trigger className="min-w-36">
                <Select.Value placeholder={t("memo.filters.any-visibility")} />
              </Select.Trigger>
              <Select.Popup>
                <Select.Item value="">{t("memo.filters.any-visibility")}</Select.Item>
                <Select.Item value={Visibility.PRIVATE}>{t("memo.visibility.private")}</Select.Item>
                <Select.Item value={Visibility.PROTECTED}>{t("memo.visibility.protected")}</Select.Item>
                <Select.Item value={Visibility.PUBLIC}>{t("memo.visibility.public")}</Select.Item>
              </Select.Popup>
            </Select.Root>
          </Field.Root>

          <Separator />

          <div className="flex flex-wrap gap-1">
            {PROPERTY_FACETS.map((option) => (
              <FacetToggle
                key={option.factor}
                option={option}
                active={hasFilter(filters, option.factor)}
                onToggle={() => apply(toggleFilter(filters, option.factor, "true"))}
              />
            ))}
          </div>
        </div>
      </Popover.Popup>
    </Popover.Root>
  );
};

export default MemoFilterPopover;
