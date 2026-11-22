import { Button, Skeleton } from "@usememos/ui";
import { ArrowUpIcon, KeyboardIcon, Trash2Icon, XIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { useAuth } from "@/contexts/AuthContext";
import { isSearchFilter, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { MentionResolutionProvider } from "@/contexts/MentionResolutionContext";
import { useNewMemo } from "@/contexts/NewMemoContext";
import { useView } from "@/contexts/ViewContext";
import { holdEditingPositions, memoNamesEditing } from "@/hooks/memoEditRegistry";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { useDevicePreferences } from "@/hooks/useDevicePreferences";
import { useDeleteMemos, useInfiniteMemos, useReorderMemos } from "@/hooks/useMemoQueries";
import { hoistMemoToFront } from "@/hooks/useMemoSorting";
import { combineCELFilters } from "@/lib/cel-filter";
import { DEFAULT_LIST_MEMOS_PAGE_SIZE, LOADING_INDICATOR_DELAY_MS } from "@/lib/constants";
import { showErrorToast, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/common_pb";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import ColumnGrid, { ColumnGridUntrappedProvider, columnCountForWidth, GRID_GAP } from "../ColumnGrid";
import ConfirmDialog from "../ConfirmDialog";
import MemoFilterPopover from "../MemoFilterPopover";
import MemoFilters from "../MemoFilters";
import { previewOrder, useDragReorder } from "../MemoMetadata/Attachment/useDragReorder";
import { MEMO_CARD_BASE_CLASSES } from "../MemoView/constants";
import Placeholder from "../Placeholder";
import EmptyLine from "./EmptyLine";
import MemoListError from "./MemoListError";
import { estimateMemoCardHeight } from "./memoCardHeight";
import { blockAnchor, moveBlock, orderUpdates } from "./memoSelection";
import { useMemoSelection } from "./useMemoSelection";

// Memo identity for React keys and grid planning. The pages use it for their renderer keys too,
// so flow-list and grid identity can never drift apart. Deliberately name-only: content updates
// reconcile in place (updateTime is a protobuf Timestamp object, not usable in a template string).
export const getMemoKey = (memo: Memo) => memo.name;

const MAX_COLUMN_WIDTH = 420;

/** Memos still loading: skeleton cards in the shape of the memos about to appear. */
const Loader = ({ count = 3 }: { count?: number }) => {
  const t = useTranslate();
  return (
    <div className="flex w-full flex-col" aria-busy="true" aria-label={t("editor.blocks.loading")}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={MEMO_CARD_BASE_CLASSES}>
          <Skeleton width="30%" height={12} />
          <Skeleton />
          <Skeleton width="70%" />
        </div>
      ))}
    </div>
  );
};

interface Props {
  /** The feed is one creator's memos under the manual (drag) sort: cards reorder by grip or pointer. */
  dragSort?: boolean;
  renderer: (memo: Memo, options: { compact: boolean }) => ReactElement;
  listSort?: (list: Memo[]) => Memo[];
  state?: State;
  orderBy?: string;
  filter?: string;
  contextFilter?: string;
  pageSize?: number;
  showCreator?: boolean;
  enabled?: boolean;
  /** Route-owned content rendered before the list and inside column one in grid mode. */
  renderLeading?: (options: { useGrid: boolean }) => ReactNode;
  /** Route-owned content spanning the full list width above every column (e.g. a page identity block). */
  renderHeader?: (options: { useGrid: boolean }) => ReactNode;
  /** Route-owned first-use content for an empty, unfiltered list. Without it the generic placeholder shows. */
  emptyState?: ReactNode;
}

function useAutoFetchWhenNotScrollable({
  enabled,
  hasNextPage,
  isFetchingNextPage,
  memoCount,
  onFetchNext,
}: {
  enabled: boolean;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  memoCount: number;
  onFetchNext: () => Promise<unknown>;
}) {
  const autoFetchTimeoutRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const isPageScrollable = useCallback(() => {
    const documentHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    return documentHeight > window.innerHeight + 100;
  }, []);

  const checkAndFetchIfNeeded = useCallback(async () => {
    if (autoFetchTimeoutRef.current) {
      clearTimeout(autoFetchTimeoutRef.current);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const shouldFetch = enabledRef.current && !isPageScrollable() && hasNextPage && !isFetchingNextPage && memoCount > 0;

    if (shouldFetch) {
      await onFetchNext();

      if (enabledRef.current) {
        autoFetchTimeoutRef.current = window.setTimeout(() => {
          void checkAndFetchIfNeeded();
        }, 500);
      }
    }
  }, [enabled, hasNextPage, isFetchingNextPage, memoCount, isPageScrollable, onFetchNext]);

  useEffect(() => {
    if (enabled && !isFetchingNextPage && memoCount > 0) {
      void checkAndFetchIfNeeded();
    }
  }, [enabled, memoCount, isFetchingNextPage, checkAndFetchIfNeeded]);

  useEffect(() => {
    if (!enabled && autoFetchTimeoutRef.current) {
      clearTimeout(autoFetchTimeoutRef.current);
      autoFetchTimeoutRef.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    return () => {
      if (autoFetchTimeoutRef.current) {
        clearTimeout(autoFetchTimeoutRef.current);
      }
    };
  }, []);
}

const PagedMemoList = (props: Props) => {
  const t = useTranslate();
  const { isUserSettingsInitialized } = useAuth();
  const { filters, memoView, removeFilter, setFilters, setMemoView } = useMemoFilterContext();
  const { setQuickFindOpen: openQuickFind, setShortcutsOpen: openShortcuts } = useAppSidebar();
  const { maxColumns, compactMode, fullWidth } = useView();
  // maxColumns is a ceiling: 1 = single reading column, 0 = as many as fit. The single
  // column renders in normal document flow; anything wider becomes the packed grid.
  const multiColumn = maxColumns !== 1;

  // Measure the available width: when it only fits one column anyway, render the flow
  // layout rather than a degenerate one-column grid (capped tiles, composer-as-tile).
  // Only the boolean is stored, so continuous resizes re-render nothing until the
  // one-column threshold is actually crossed.
  const layoutMeasureRef = useRef<HTMLDivElement>(null);
  const [fitsGridWidth, setFitsGridWidth] = useState<boolean | undefined>(undefined);
  useLayoutEffect(() => {
    const el = layoutMeasureRef.current;
    if (!el) return;
    const apply = (nextWidth: number) => setFitsGridWidth(columnCountForWidth(nextWidth) >= 2);
    apply(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const useGrid = multiColumn && (fitsGridWidth ?? true);
  // Grid tiles are always bounded/compact; the narrow-width fallback behaves exactly like
  // maxColumns = 1, so it respects the user's own compact setting. Centralized here so the
  // pages don't each repeat the policy.
  const effectiveCompact = compactMode || useGrid;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error, isFetchNextPageError, refetch } =
    useInfiniteMemos(
      {
        state: props.state || State.NORMAL,
        orderBy: props.orderBy || "create_time desc",
        filter: combineCELFilters(props.contextFilter, props.filter),
        pageSize: props.pageSize || DEFAULT_LIST_MEMOS_PAGE_SIZE,
      },
      { enabled: props.enabled ?? true },
    );

  // Tag settings decide whether sensitive memo content must be blurred. Keep that
  // privacy boundary, but do not wait for unrelated memo views or instance settings.
  const isDisplayPending = isLoading || !isUserSettingsInitialized;
  // A failed first page leaves nothing to show; a failed later page keeps what already
  // loaded. Either way, automatic pagination pauses until the user retries.
  const isInitialError = isError && !isFetchNextPageError;
  const canPaginate = !isDisplayPending && !isError;
  const showLoader = useDelayedFlag(isDisplayPending, LOADING_INDICATOR_DELAY_MS);

  // Flatten pages into a single array of memos
  const memos = useMemo(() => data?.pages.flatMap((page) => page.memos) || [], [data]);

  // Apply custom sorting if provided, otherwise use memos directly, then hoist
  // a freshly created memo to the very top so it stays visible above pins.
  const { newMemoName } = useNewMemo();
  // A memo under edit holds the position it showed when its edit started: saving
  // (which moves its update time) or a pause while typing must not slide the card
  // out from under the caret.
  const previousOrderRef = useRef<Memo[]>([]);
  const sortedMemoList = useMemo(() => {
    const sorted = props.listSort ? props.listSort(memos) : memos;
    const hoisted = hoistMemoToFront(sorted, newMemoName);
    const held = holdEditingPositions(hoisted, previousOrderRef.current, memoNamesEditing());
    previousOrderRef.current = held;
    return held;
  }, [memos, props.listSort, newMemoName]);

  // Auto-fetch hook: fetches more content when page isn't scrollable
  useAutoFetchWhenNotScrollable({
    enabled: canPaginate,
    hasNextPage,
    isFetchingNextPage,
    memoCount: sortedMemoList.length,
    onFetchNext: fetchNextPage,
  });

  // Infinite scroll: fetch more when user scrolls near bottom
  useEffect(() => {
    if (!canPaginate || !hasNextPage) return;

    const handleScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 300;
      if (nearBottom && !isFetchingNextPage) {
        fetchNextPage();
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [canPaginate, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const leadingContent = props.renderLeading?.({ useGrid });
  const headerContent = props.renderHeader?.({ useGrid });

  // A freshly created memo is hoisted to the front; pin it to the top of column one so it
  // appears right under the composer instead of dropping into a random (shortest) column.
  const displayMemoList = isDisplayPending || isInitialError ? [] : sortedMemoList;
  const firstMemo = displayMemoList[0];
  const priorityKey = newMemoName && firstMemo?.name === newMemoName ? getMemoKey(firstMemo) : undefined;

  // Stable reference so MentionResolutionProvider's memo (keyed on the array) actually holds.
  // The manual order's drag: the shown order is the drop preview; dropping renumbers the
  // visible memos to their positions, so every card keeps a stable drag order value.
  const reorder = useReorderMemos();
  const deleteMemos = useDeleteMemos();
  const flowContainerRef = useRef<HTMLDivElement>(null);
  const selectionEnabled = !useGrid && !isDisplayPending && !isInitialError;
  const displayNames = useMemo(() => displayMemoList.map((memo) => memo.name), [displayMemoList]);
  const selection = useMemoSelection({ containerRef: flowContainerRef, names: displayNames, enabled: selectionEnabled });
  const selectedNames = selection.selected;
  const isSelected = (memo: Memo) => selectedNames.has(memo.name);
  // Dragging a selected card carries the whole selection; any other card drags alone and leaves the selection.
  const flowDrag = useDragReorder(displayMemoList.length, (from, to) => {
    const dragged = displayMemoList[from];
    const block = dragged && selectedNames.has(dragged.name) && selectedNames.size > 1;
    const next = block
      ? moveBlock(displayMemoList, isSelected, blockAnchor(displayMemoList, isSelected, from, to))
      : previewOrder(displayMemoList, from, to);
    const updates = orderUpdates(next);
    if (updates.length > 0) reorder.mutate(updates);
  });
  const draggingBlock =
    props.dragSort && flowDrag.dragging !== null && selectedNames.size > 1 && selectedNames.has(displayMemoList[flowDrag.dragging]?.name);
  // While a block drags, the shown order is the block's drop preview; otherwise it's the single-card preview.
  const shownFlowList = !props.dragSort
    ? displayMemoList
    : draggingBlock && flowDrag.dragging !== null && flowDrag.over !== null
      ? moveBlock(displayMemoList, isSelected, blockAnchor(displayMemoList, isSelected, flowDrag.dragging, flowDrag.over))
      : previewOrder(displayMemoList, flowDrag.dragging, flowDrag.over);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const selectedList = displayMemoList.filter(isSelected);
  const deletableSelection = selectedList.length > 0;
  const { skipDeleteConfirm } = useDevicePreferences();
  const confirmDeleteSelected = async () => {
    const names = selectedList.map((memo) => memo.name);
    const { deleted, failed } = await deleteMemos.mutateAsync(names);
    if (deleted.length > 0) toast.add({ title: t("memo.deleted-count", { count: deleted.length }), type: "success" });
    if (failed.length > 0) {
      showErrorToast(t("memo.delete-failed-count", { count: failed.length }));
      selection.setSelected(new Set(failed));
    } else {
      selection.clear();
    }
  };
  const requestDeleteSelected = () => {
    if (!deletableSelection) return;
    if (skipDeleteConfirm) void confirmDeleteSelected();
    else setDeleteOpen(true);
  };

  // Delete/Backspace removes the selection, but never while a field, the editor or a dialog has the keys,
  // and never from a card that is being edited: selection and editing stay separate.
  useEffect(() => {
    if (!selectionEnabled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedNames.size > 0 && !deleteOpen) {
        const active = document.activeElement as HTMLElement | null;
        if (!active?.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) selection.clear();
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || deleteOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog], [role=alertdialog]"))
        return;
      if (memoNamesEditing().size > 0 && selectedList.some((memo) => memoNamesEditing().has(memo.name))) return;
      if (!deletableSelection) return;
      event.preventDefault();
      requestDeleteSelected();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const contents = useMemo(() => displayMemoList.map((memo) => memo.content), [displayMemoList]);
  const userNames = useMemo(
    () =>
      Array.from(
        new Set(
          displayMemoList.flatMap((memo) => [
            ...(props.showCreator ? [memo.creator] : []),
            ...(memo.reactions ?? []).map((reaction) => reaction.creator),
          ]),
        ),
      ),
    [props.showCreator, displayMemoList],
  );

  const hasFilters = filters.length > 0 || memoView !== undefined;
  const isEmpty = !isDisplayPending && !isError && !isFetchingNextPage && !hasNextPage && displayMemoList.length === 0;
  const clearFilters = () => {
    setFilters([]);
    setMemoView(undefined);
  };
  // No results is neutral and offers the way out; first use belongs to the route.
  const emptyPlaceholder = !isEmpty ? null : hasFilters ? (
    <EmptyLine message={t("memo.no-matching-memos")} action={t("memo.clear-filters")} onAction={clearFilters} />
  ) : (
    (props.emptyState ?? <Placeholder scene="memo" message={t("message.no-data")} className="w-full" />)
  );
  const initialLoader = isDisplayPending && showLoader ? <Loader /> : null;
  // Only a query the user typed can be edited or cleared from the error; facet and scope
  // filters are fixed by the route.
  const hasSearch = filters.some(isSearchFilter);
  const errorNotice =
    !isDisplayPending && isError ? (
      <MemoListError
        error={error}
        onRetry={isFetchNextPageError ? fetchNextPage : refetch}
        onEditQuery={hasSearch ? () => openQuickFind(true) : undefined}
        onClearQuery={hasSearch ? () => removeFilter(isSearchFilter) : undefined}
      />
    ) : null;
  const initialError = isInitialError ? errorNotice : null;
  const pageError = isFetchNextPageError ? errorNotice : null;

  // Column one is the action column: the composer and any active filters head it, and the
  // empty state follows them. The newest memo also lands directly beneath them (priorityKey
  // above). Every vertical seam inside the stack uses GRID_GAP so y-spacing matches the
  // grid's x-spacing exactly.
  const gridLeading =
    leadingContent || hasFilters || initialLoader || emptyPlaceholder || initialError ? (
      <div className="flex w-full flex-col" style={{ gap: GRID_GAP }}>
        {leadingContent}
        <div className="flex items-center gap-1.5">
          <MemoFilterPopover />
          <MemoFilters />
        </div>
        {initialLoader}
        {initialError}
        {emptyPlaceholder}
      </div>
    ) : undefined;

  // Pagination controls are identical across both layouts.
  const footer = (
    <>
      {pageError}
      {isFetchingNextPage && <Loader count={1} />}
      {!isFetchingNextPage && (hasNextPage || displayMemoList.length > 0) && <BackToTop />}
    </>
  );

  // Both the drag hook and the selection hook need the flow container.
  const dragContainerRef = flowDrag.containerRef;
  const setFlowContainer = useCallback(
    (element: HTMLDivElement | null) => {
      flowContainerRef.current = element;
      dragContainerRef.current = props.dragSort ? element : null;
    },
    [dragContainerRef, props.dragSort],
  );
  const handleClickCapture = (event: React.MouseEvent) => {
    selection.clickCapture(event);
    if (props.dragSort && !event.isPropagationStopped()) flowDrag.clickCapture(event);
  };

  const draggedMemo = props.dragSort && flowDrag.dragging !== null ? displayMemoList[flowDrag.dragging] : undefined;
  const children = (
    <MentionResolutionProvider contents={contents} userNames={userNames}>
      <div ref={layoutMeasureRef} className="w-full">
        <div
          ref={useGrid ? undefined : setFlowContainer}
          onPointerDown={selectionEnabled ? selection.containerPointerDown : undefined}
          onClickCapture={useGrid ? undefined : handleClickCapture}
          className={cn("relative flex flex-col justify-start w-full mx-auto", useGrid || fullWidth ? "max-w-none" : "max-w-2xl")}
        >
          {useGrid ? (
            <>
              <ColumnGridUntrappedProvider>
                <ColumnGrid
                  items={displayMemoList}
                  getKey={getMemoKey}
                  renderItem={(memo) => props.renderer(memo, { compact: effectiveCompact })}
                  estimateHeight={estimateMemoCardHeight}
                  header={headerContent}
                  leading={gridLeading}
                  priorityKey={priorityKey}
                  maxColumns={maxColumns}
                  maxColumnWidth={fullWidth ? undefined : MAX_COLUMN_WIDTH}
                />
              </ColumnGridUntrappedProvider>
              {!isDisplayPending && footer}
            </>
          ) : (
            <>
              {headerContent}
              {leadingContent}
              <MemoFilters className="mb-2" />
              {initialLoader}
              {initialError}
              {shownFlowList.map((memo, position) => {
                if (!props.dragSort) {
                  const picked = selectedNames.has(memo.name);
                  return (
                    <div
                      key={getMemoKey(memo)}
                      data-memo-name={memo.name}
                      data-selected={picked || undefined}
                      className={cn("rounded-mu-lg", picked && "outline-2 outline-offset-0 outline-mu-primary [&>*]:bg-mu-selected")}
                    >
                      {props.renderer(memo, { compact: effectiveCompact })}
                    </div>
                  );
                }
                const index = displayMemoList.indexOf(memo);
                const placeholder = props.dragSort && flowDrag.dragging === index;
                const picked = selectedNames.has(memo.name);
                // The other cards of a dragged selection fade, so the block reads as one lifted group.
                const carried = draggingBlock && picked && !placeholder;
                return (
                  <div
                    key={getMemoKey(memo)}
                    data-memo-name={memo.name}
                    data-selected={picked || undefined}
                    data-reorder-position={position}
                    data-reorder-key={memo.name}
                    data-reorder-placeholder={placeholder || undefined}
                    onPointerDown={flowDrag.pointerDown(index, { longPress: true })}
                    onKeyDown={flowDrag.keyDown(index)}
                    aria-hidden={placeholder || undefined}
                    className={cn(
                      "relative rounded-mu-lg",
                      picked && "outline-2 outline-offset-0 outline-mu-primary [&>*]:bg-mu-selected",
                      placeholder && "[&>*]:opacity-0",
                      carried && "opacity-40",
                    )}
                  >
                    {props.renderer(memo, { compact: effectiveCompact })}
                  </div>
                );
              })}
              <div className="mt-2 flex items-center gap-1">
                <MemoFilterPopover />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("shortcut.title")}
                  onClick={() => openShortcuts(true)}
                  icon={<KeyboardIcon />}
                />
              </div>
              {emptyPlaceholder}
              {!isDisplayPending && footer}
            </>
          )}
        </div>
      </div>

      {selection.band && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-(--mu-layer-popup) rounded-mu-sm border border-mu-primary bg-mu-primary/10"
          style={{
            left: (flowContainerRef.current?.getBoundingClientRect().left ?? 0) + selection.band.left,
            top: (flowContainerRef.current?.getBoundingClientRect().top ?? 0) + selection.band.top,
            width: selection.band.right - selection.band.left,
            height: selection.band.bottom - selection.band.top,
          }}
        />
      )}

      {selectedList.length > 0 && !useGrid && (
        <div
          role="status"
          className="fixed bottom-4 start-1/2 z-(--mu-layer-popup) flex -translate-x-1/2 items-center gap-1 rounded-mu-lg border border-mu-edge bg-mu-surface px-2 py-1 shadow-lg"
        >
          <span className="px-2 mu-label text-mu-text">{t("memo.selected-count", { count: selectedList.length })}</span>
          <Button variant="ghost" size="sm" icon={<Trash2Icon />} onClick={requestDeleteSelected}>
            {t("common.delete")}
          </Button>
          <Button variant="ghost" size="sm" icon={<XIcon />} aria-label={t("common.clear")} onClick={selection.clear} />
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("memo.delete-selected-confirm", { count: selectedList.length })}
        description={t("memo.delete-confirm-description")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmDeleteSelected}
        confirmVariant="danger"
      />

      {/* The lifted memo follows the pointer above everything; its card shows the drop slot. */}
      {draggedMemo &&
        flowDrag.grab &&
        createPortal(
          <div
            ref={flowDrag.ghostRef}
            className="pointer-events-none fixed start-0 top-0 z-(--mu-layer-popup) max-w-(--mu-popover-width) rounded-mu-lg border border-mu-edge bg-mu-surface px-4 py-3 shadow-lg [scale:1.03]"
            style={{
              width: flowDrag.grab.width,
              height: flowDrag.grab.height,
              translate: `${flowDrag.grab.left}px ${flowDrag.grab.top}px`,
            }}
          >
            <p className="line-clamp-6 mu-body text-mu-text whitespace-pre-wrap">{draggedMemo.snippet || draggedMemo.content}</p>
          </div>,
          document.body,
        )}
    </MentionResolutionProvider>
  );

  return children;
};

const BackToTop = () => {
  const t = useTranslate();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const shouldShow = window.scrollY > 400;
      setIsVisible(shouldShow);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  // Render nothing at all while hidden, so the list's end carries no phantom spacing.
  if (!isVisible) {
    return null;
  }

  return (
    <div className="my-4 flex w-full flex-row items-center justify-center opacity-70">
      <Button variant="ghost" iconEnd={<ArrowUpIcon />} onClick={scrollToTop}>
        {t("router.back-to-top")}
      </Button>
    </div>
  );
};

export default PagedMemoList;
