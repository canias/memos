import { describe, expect, it } from "vitest";
import {
  bandSelection,
  blockAnchor,
  moveBlock,
  orderUpdates,
  rangeBetween,
  rectFromPoints,
  rectsIntersect,
  toggleSelected,
} from "@/components/PagedMemoList/memoSelection";

const list = ["a", "b", "c", "d", "e", "f"];
const picks = (...names: string[]) => {
  const set = new Set(names);
  return (item: string) => set.has(item);
};

describe("memo selection", () => {
  it("builds a rectangle from any two corners", () => {
    expect(rectFromPoints(10, 20, 2, 5)).toEqual({ left: 2, top: 5, right: 10, bottom: 20 });
  });

  it("intersects overlapping rectangles but not touching ones", () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(rectsIntersect(a, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(true);
    expect(rectsIntersect(a, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
  });

  it("replaces the selection with a plain band and extends it with a modifier band", () => {
    const base = new Set(["a"]);
    expect([...bandSelection(base, ["b", "c"], false)]).toEqual(["b", "c"]);
    expect([...bandSelection(base, ["b", "c"], true)]).toEqual(["a", "b", "c"]);
  });

  it("toggles a name without touching the original set", () => {
    const base = new Set(["a"]);
    expect([...toggleSelected(base, "b")]).toEqual(["a", "b"]);
    expect([...toggleSelected(base, "a")]).toEqual([]);
    expect([...base]).toEqual(["a"]);
  });

  it("selects every name between the anchor and the target, in either direction", () => {
    expect(rangeBetween(list, "b", "e")).toEqual(["b", "c", "d", "e"]);
    expect(rangeBetween(list, "e", "b")).toEqual(["b", "c", "d", "e"]);
    expect(rangeBetween(list, "c", "c")).toEqual(["c"]);
  });

  it("falls back to the target alone without a usable anchor", () => {
    expect(rangeBetween(list, null, "d")).toEqual(["d"]);
    expect(rangeBetween(list, "gone", "d")).toEqual(["d"]);
    expect(rangeBetween(list, "a", "gone")).toEqual([]);
  });

  it("moves a block of selected items together, keeping their relative order", () => {
    // b and d dragged down onto f: the block lands after f.
    const down = moveBlock(list, picks("b", "d"), blockAnchor(list, picks("b", "d"), 1, 5));
    expect(down).toEqual(["a", "c", "e", "f", "b", "d"]);
    // d and e dragged up onto a: the block lands before a.
    const up = moveBlock(list, picks("d", "e"), blockAnchor(list, picks("d", "e"), 3, 0));
    expect(up).toEqual(["d", "e", "a", "b", "c", "f"]);
  });

  it("is a no-op when the block is dropped where it already is", () => {
    const same = moveBlock(list, picks("b", "c"), blockAnchor(list, picks("b", "c"), 1, 1));
    expect(same).toEqual(list);
  });

  it("clamps a drop past either end", () => {
    expect(moveBlock(list, picks("c", "d"), 99)).toEqual(["a", "b", "e", "f", "c", "d"]);
    expect(moveBlock(list, picks("c", "d"), -4)).toEqual(["c", "d", "a", "b", "e", "f"]);
  });

  it("only renumbers memos whose position changed", () => {
    const memos = [
      { name: "memos/1", order: 1 },
      { name: "memos/2", order: 2 },
      { name: "memos/3", order: undefined },
    ];
    expect(orderUpdates([memos[0], memos[2], memos[1]])).toEqual([
      { name: "memos/3", order: 2 },
      { name: "memos/2", order: 3 },
    ]);
  });
});
