import { useEffect, useRef, useState } from "react";
import { memoNamesEditing } from "@/hooks/memoEditRegistry";
import type { Memo } from "@/types/proto/api/memo_service_pb";

/** True when the event's target takes character keys (an editor, an input, a popup). */
const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

/** True while an overlay owns the keyboard: a dialog, menu, or the quick-find popup. */
const isOverlayOpen = (): boolean =>
  document.querySelector("[role=dialog], [role=menu], [data-popup-open], [data-quick-find-open]") !== null;

/**
 * Feed keyboard control. `j/k` and the arrows move a focus ring across the cards (scrolling
 * as they go), `enter` or `e` edits the focused memo in place, `o` opens it, `/` opens Quick
 * Find, `f` the filter popover and `?` the shortcut cheat sheet, and every other key leaves
 * the page's inputs untouched.
 */
export const useMemoListHotkeys = ({
  memos,
  onOpen,
  onEditFocused,
  onOpenQuickFind,
  onOpenFilters,
  onOpenShortcuts,
}: {
  memos: readonly Memo[];
  onOpen: (memo: Memo) => void;
  /** Edits the focused memo in place; the card receives the request and opens its editor. */
  onEditFocused?: (memo: Memo) => void;
  onOpenQuickFind?: () => void;
  onOpenFilters?: () => void;
  onOpenShortcuts?: () => void;
}): { focusedName: string | undefined; clearFocus: () => void } => {
  const [focusedName, setFocusedName] = useState<string | undefined>(undefined);
  const focusedNameRef = useRef<string | undefined>(undefined);
  focusedNameRef.current = focusedName;
  const memosRef = useRef(memos);
  memosRef.current = memos;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const openersRef = useRef({ onEditFocused, onOpenQuickFind, onOpenFilters, onOpenShortcuts });
  openersRef.current = { onEditFocused, onOpenQuickFind, onOpenFilters, onOpenShortcuts };

  useEffect(() => {
    const cardOf = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-memo-name="${CSS.escape(name)}"]`);

    const focusAt = (index: number) => {
      const list = memosRef.current;
      if (list.length === 0) return;
      const next = list[Math.max(0, Math.min(index, list.length - 1))];
      setFocusedName(next.name);
      cardOf(next.name)?.scrollIntoView({ block: "nearest" });
    };

    const step = (delta: number) => {
      const list = memosRef.current;
      const current = focusedNameRef.current ? list.findIndex((memo) => memo.name === focusedNameRef.current) : -1;
      focusAt(current < 0 ? (delta > 0 ? 0 : list.length - 1) : current + delta);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || isOverlayOpen()) return;
      switch (event.key) {
        case "j":
        case "J":
        case "ArrowDown":
          event.preventDefault();
          step(1);
          break;
        case "k":
        case "K":
        case "ArrowUp":
          event.preventDefault();
          step(-1);
          break;
        case "o":
        case "O": {
          const focused = focusedNameRef.current;
          if (!focused) return;
          event.preventDefault();
          const memo = memosRef.current.find((item) => item.name === focused);
          if (memo) onOpenRef.current(memo);
          break;
        }
        case "Escape":
          if (focusedNameRef.current) {
            setFocusedName(undefined);
          }
          break;
        case "Enter":
        case "e":
        case "E": {
          const focused = focusedNameRef.current;
          if (!focused) return;
          event.preventDefault();
          const memo = memosRef.current.find((item) => item.name === focused);
          if (memo) openersRef.current.onEditFocused?.(memo);
          break;
        }
        case "/":
          event.preventDefault();
          openersRef.current.onOpenQuickFind?.();
          break;
        case "f":
        case "F":
          event.preventDefault();
          openersRef.current.onOpenFilters?.();
          break;
        case "?":
          event.preventDefault();
          openersRef.current.onOpenShortcuts?.();
          break;
        default:
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // A focused card that left the feed (a filter changed) clears the ring.
  useEffect(() => {
    if (focusedName && !memos.some((memo) => memo.name === focusedName && !memoNamesEditing().has(memo.name))) {
      setFocusedName(undefined);
    }
  }, [memos, focusedName]);

  return { focusedName, clearFocus: () => setFocusedName(undefined) };
};

export default useMemoListHotkeys;
