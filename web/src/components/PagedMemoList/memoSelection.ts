/** A rectangle in any one coordinate space; the helpers below only compare rectangles with each other. */
export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The rectangle spanned by two points, whichever corner the drag started from. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): SelectionRect {
  return { left: Math.min(ax, bx), top: Math.min(ay, by), right: Math.max(ax, bx), bottom: Math.max(ay, by) };
}

/** Whether two rectangles overlap (touching edges don't count). */
export function rectsIntersect(a: SelectionRect, b: SelectionRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * The names a rubber-band selection ends up with. A plain band replaces the selection it started
 * from; with `additive` (Ctrl, Cmd or Shift held) the band adds to it.
 */
export function bandSelection(base: ReadonlySet<string>, hit: readonly string[], additive: boolean): Set<string> {
  return new Set(additive ? [...base, ...hit] : hit);
}

/** `selection` with `name` added when absent and removed when present. */
export function toggleSelected(selection: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(selection);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return next;
}

/**
 * The names from `anchor` through `target` in list order, both included. Without a usable anchor (none
 * yet, or it left the list) the range is just `target`.
 */
export function rangeBetween(names: readonly string[], anchor: string | null, target: string): string[] {
  const to = names.indexOf(target);
  if (to < 0) return [];
  const from = anchor === null ? -1 : names.indexOf(anchor);
  if (from < 0) return [target];
  return names.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/**
 * The list after a block drag: the selected items keep their relative order and land together, with the
 * first of them at `anchor`, an index in the list the block leaves behind (the rest, in order). `anchor`
 * is clamped, so a drop past either end puts the block at that end.
 */
export function moveBlock<T>(list: readonly T[], isSelected: (item: T) => boolean, anchor: number): T[] {
  const block = list.filter(isSelected);
  const rest = list.filter((item) => !isSelected(item));
  const at = Math.max(0, Math.min(anchor, rest.length));
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/**
 * Where the block's first item lands when the item at `from` is dragged onto the place `to` of the full
 * list: the number of unselected items that stay in front of the place the pointer is over.
 */
export function blockAnchor<T>(list: readonly T[], isSelected: (item: T) => boolean, from: number, to: number): number {
  const rest = list.filter((item) => !isSelected(item));
  if (to <= from) {
    // Moving up: the block goes in front of the item that sits at `to`, unless that item is part of the block.
    let anchor = 0;
    for (let index = 0; index < to; index++) if (!isSelected(list[index])) anchor++;
    return Math.min(anchor, rest.length);
  }
  // Moving down: the block goes behind the item that sits at `to`, unless that item is part of the block.
  let anchor = 0;
  for (let index = 0; index <= to; index++) if (!isSelected(list[index])) anchor++;
  return Math.min(anchor, rest.length);
}

/** Order values for a list shown in its new order: only the memos whose position changed need an update. */
export function orderUpdates<T extends { name: string; order?: number }>(next: readonly T[]): { name: string; order: number }[] {
  return next
    .map((memo, index) => ({ name: memo.name, order: index + 1, changed: memo.order !== index + 1 }))
    .filter((update) => update.changed)
    .map(({ name, order }) => ({ name, order }));
}
