import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { useMemo } from "react";
import { type MemoTimeBasis, useView } from "@/contexts/ViewContext";
import { State } from "@/types/proto/api/common_pb";
import type { Memo } from "@/types/proto/api/memo_service_pb";

export interface UseMemoSortingOptions {
  pinnedFirst?: boolean;
  state?: State;
}

export interface UseMemoSortingResult {
  listSort: (memos: Memo[]) => Memo[];
  orderBy: string;
}

/** The timestamp a memo is ordered and bucketed by under `timeBasis`. */
export const getMemoSortTime = (memo: Memo, timeBasis: MemoTimeBasis): Date | undefined => {
  const timestamp = timeBasis === "update_time" ? memo.updateTime : memo.createTime;
  return timestamp ? timestampDate(timestamp) : undefined;
};

// Moves the memo with the given name to the front of the list, above pinned
// memos, so a freshly created memo is immediately visible. Returns the input
// unchanged when the name is null, absent, or already first.
export const hoistMemoToFront = (memos: Memo[], name: string | null): Memo[] => {
  if (!name) return memos;
  const index = memos.findIndex((memo) => memo.name === name);
  if (index <= 0) return memos;
  const reordered = memos.slice();
  const [memo] = reordered.splice(index, 1);
  reordered.unshift(memo);
  return reordered;
};

/**
 * Sorting for one feed. The manual (drag) order applies only where the whole feed is one
 * creator's memos — an owner's timeline — so a mixed-author feed like Explore keeps its
 * chronological order no matter what every author's drag order was.
 */
export const useMemoSorting = (options: UseMemoSortingOptions = {}): UseMemoSortingResult => {
  const { pinnedFirst = false, state = State.NORMAL } = options;
  const { orderByTimeAsc, timeBasis, manualOrder: viewManualOrder } = useView();
  // The feed's own scope decides: an owner's feed honors the saved preference.
  const manualOrder = Boolean(pinnedFirst && viewManualOrder);

  // Generate orderBy string for API. The manual order sort puts memos that carry a
  // dragged position first, in that order; the rest follow their time order.
  const orderBy = useMemo(() => {
    const timeOrder = orderByTimeAsc ? `${timeBasis} asc` : `${timeBasis} desc`;
    if (manualOrder) return pinnedFirst ? `pinned desc, order asc, ${timeOrder}` : `order asc, ${timeOrder}`;
    return pinnedFirst ? `pinned desc, ${timeOrder}` : timeOrder;
  }, [pinnedFirst, orderByTimeAsc, timeBasis, manualOrder]);

  // Generate listSort function for client-side sorting
  const listSort = useMemo(() => {
    return (memos: Memo[]): Memo[] => {
      return memos
        .filter((memo) => memo.state === state)
        .sort((a, b) => {
          // First, sort by pinned status if enabled
          if (pinnedFirst && a.pinned !== b.pinned) {
            return b.pinned ? 1 : -1;
          }

          // Under the manual order, memos with a dragged position lead (by it), and
          // the rest follow their time order behind them.
          if (manualOrder) {
            const aOrder = a.order;
            const bOrder = b.order;
            if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) return aOrder - bOrder;
            if (aOrder !== undefined && bOrder === undefined) return -1;
            if (aOrder === undefined && bOrder !== undefined) return 1;
          }

          // Then sort by the selected time field.
          const aTime = getMemoSortTime(a, timeBasis);
          const bTime = getMemoSortTime(b, timeBasis);
          return orderByTimeAsc ? dayjs(aTime).unix() - dayjs(bTime).unix() : dayjs(bTime).unix() - dayjs(aTime).unix();
        });
    };
  }, [pinnedFirst, state, orderByTimeAsc, timeBasis, manualOrder]);

  return { listSort, orderBy };
};
