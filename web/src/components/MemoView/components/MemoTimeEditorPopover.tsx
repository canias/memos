import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Popover } from "@usememos/ui";
import { type FC } from "react";
import { Link } from "react-router-dom";
import { TimestampInput } from "@/components/MemoEditor/edit/components/TimestampPopover";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import i18n from "@/i18n";
import { showErrorToast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import { MEMO_TIME_CONTROL_CLASSES } from "../constants";
import { createMemoNavigationState } from "../navigation";

const formatFull = (date: Date): string => date.toLocaleString(i18n.language);

/**
 * The memo's time as its permalink can be when the viewer only reads; for the owner the
 * time is a control: one click on it opens the date selector and moves the memo. The
 * permalink keeps a row inside for the detail page.
 */
export const MemoTimeEditorPopover: FC<{
  memoName: string;
  createTime: Date | undefined;
  parentPage: string;
  /** The card's usual time label, now the trigger's face. */
  children: React.ReactNode;
}> = ({ memoName, createTime, parentPage, children }) => {
  const t = useTranslate();
  const { mutate: updateMemo } = useUpdateMemo(memoName);

  if (!createTime) return null;

  const changeTime = (date: Date) => {
    updateMemo(
      { update: { name: memoName, createTime: timestampFromDate(date) }, updateMask: ["create_time"] },
      {
        onError: () => showErrorToast(t("memo.change-date-failed")),
      },
    );
  };

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <button
            type="button"
            className={MEMO_TIME_CONTROL_CLASSES}
            aria-label={t("memo.change-date")}
            title={`${t("common.created-at")}: ${formatFull(createTime)}`}
          >
            {children}
          </button>
        }
      />
      <Popover.Popup align="start" className="w-auto">
        <TimestampInput label={t("common.created-at")} date={createTime} onChange={changeTime} />
        <div className="mt-1 flex w-full items-center justify-between mu-body">
          <Link
            className="underline-offset-2 hover:underline"
            state={createMemoNavigationState(parentPage)}
            to={`/${memoName}`}
            viewTransition
          >
            {t("memo.view-details")}
          </Link>
        </div>
      </Popover.Popup>
    </Popover.Root>
  );
};

export default MemoTimeEditorPopover;
