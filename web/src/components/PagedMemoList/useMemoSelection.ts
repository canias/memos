import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { bandSelection, rangeBetween, rectFromPoints, rectsIntersect, type SelectionRect, toggleSelected } from "./memoSelection";

/** Pointer travel before a press on empty space becomes a rubber band, so a plain click stays a click. */
const BAND_THRESHOLD_PX = 4;

/** What a press on empty space or a card may start the band on: not a control, not text being edited. */
const INTERACTIVE = "button, a, input, textarea, select, [role=menuitem], [contenteditable]:not([contenteditable=false])";

interface Options {
  /** The element whose `[data-memo-name]` children are the selectable cards. */
  containerRef: RefObject<HTMLElement | null>;
  /** Names of the memos shown, in order. Names that leave the list are dropped from the selection. */
  names: readonly string[];
  enabled: boolean;
}

/**
 * Selection of memo cards, separate from editing: Ctrl/Cmd-click toggles a card, Shift-click selects the
 * range from the last picked card (the anchor) to the clicked one, a rubber band dragged
 * over the list picks the cards it touches (Ctrl/Cmd/Shift adds to the selection), and Escape or a click
 * on empty space clears it. `band` is the live rectangle (container-relative) while one is dragged.
 */
export function useMemoSelection({ containerRef, names, enabled }: Options) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [band, setBand] = useState<SelectionRect | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const bandRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    base: ReadonlySet<string>;
    additive: boolean;
    active: boolean;
    /** Card rectangles in container coordinates, measured when the press lands. */
    cards: { name: string; rect: SelectionRect }[];
  } | null>(null);
  const suppressClick = useRef(false);
  // The card a Shift-click ranges from: the last one picked by a plain gesture.
  const anchorRef = useRef<string | null>(null);
  const namesRef = useRef(names);
  namesRef.current = names;

  const update = useCallback((next: ReadonlySet<string>) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  // Memos that left the list (deleted, archived, filtered out) can't stay selected.
  useEffect(() => {
    if (selectedRef.current.size === 0) return;
    const shown = new Set(names);
    const kept = [...selectedRef.current].filter((name) => shown.has(name));
    if (kept.length !== selectedRef.current.size) update(new Set(kept));
  }, [names, update]);

  useEffect(() => {
    if (!enabled && selectedRef.current.size > 0) update(new Set());
  }, [enabled, update]);

  const clear = useCallback(() => {
    anchorRef.current = null;
    update(new Set());
  }, [update]);

  const measureCards = () => {
    const container = containerRef.current;
    const box = container?.getBoundingClientRect();
    if (!container || !box) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(":scope > [data-memo-name]")).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        name: element.dataset.memoName as string,
        rect: { left: rect.left - box.left, top: rect.top - box.top, right: rect.right - box.left, bottom: rect.bottom - box.top },
      };
    });
  };

  useEffect(() => {
    if (!enabled) return;
    const handleMove = (event: PointerEvent) => {
      const press = bandRef.current;
      const box = containerRef.current?.getBoundingClientRect();
      if (!press || !box || event.pointerId !== press.pointerId) return;
      if (!press.active) {
        if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < BAND_THRESHOLD_PX) return;
        press.active = true;
      }
      const rect = rectFromPoints(press.startX - box.left, press.startY - box.top, event.clientX - box.left, event.clientY - box.top);
      setBand(rect);
      const hit = press.cards.filter((card) => rectsIntersect(card.rect, rect)).map((card) => card.name);
      update(bandSelection(press.base, hit, press.additive));
    };
    const handleUp = (event: PointerEvent) => {
      const press = bandRef.current;
      if (!press || event.pointerId !== press.pointerId) return;
      bandRef.current = null;
      setBand(null);
      if (press.active) {
        // The click that follows a band's release must not clear it or open a card.
        suppressClick.current = true;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && bandRef.current?.active) {
        update(bandRef.current.base);
        bandRef.current = null;
        setBand(null);
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      window.removeEventListener("keydown", handleKey);
    };
  }, [enabled, containerRef, update]);

  /**
   * Pointer press on the list container. Ctrl/Cmd on a card toggles it; a press that lands outside any card
   * (the gaps and margins) starts a rubber band. A press on a card without a modifier is left to the card.
   */
  const containerPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0 || event.pointerType === "touch") return;
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const card = target.closest<HTMLElement>("[data-memo-name]");
    const name = card?.dataset.memoName;
    if (card && name && containerRef.current?.contains(card)) {
      if (!additive) return;
      // A modifier press picks the card; it must neither start editing nor a text selection.
      event.preventDefault();
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        // Shift: everything between the anchor and this card joins the selection; the anchor stays put.
        const range = rangeBetween(namesRef.current, anchorRef.current, name);
        if (anchorRef.current === null || !namesRef.current.includes(anchorRef.current)) anchorRef.current = name;
        update(new Set([...selectedRef.current, ...range]));
      } else {
        anchorRef.current = name;
        update(toggleSelected(selectedRef.current, name));
      }
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      return;
    }
    bandRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      base: additive ? selectedRef.current : new Set(),
      additive,
      active: false,
      cards: measureCards(),
    };
    if (!additive && selectedRef.current.size > 0) clear();
  };

  /** Capture-phase click filter: swallows the click a band release or a Ctrl-click would otherwise deliver. */
  const clickCapture = (event: ReactMouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // A Ctrl/Cmd/Shift click on a card is a selection gesture, never a link or edit click.
    if ((event.ctrlKey || event.metaKey || event.shiftKey) && (event.target as HTMLElement).closest("[data-memo-name]")) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return { selected, band, clear, setSelected: update, containerPointerDown, clickCapture };
}
