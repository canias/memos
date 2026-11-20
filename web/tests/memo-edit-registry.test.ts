import { describe, expect, it } from "vitest";
import { holdEditingPositions } from "@/hooks/memoEditRegistry";

const named = (...names: string[]) => names.map((name) => ({ name }));

describe("holdEditingPositions", () => {
  it("keeps an edited memo at its previous position when the sort would move it", () => {
    const previous = named("a", "b", "c");
    const next = named("c", "a", "b");
    const editing = new Set(["c"]);

    // `c` edited at position 2, so it holds there while others slide around it.
    expect(holdEditingPositions(next, previous, editing)).toEqual(named("a", "b", "c"));
  });

  it("keeps several edited memos in place at once", () => {
    const previous = named("a", "b", "c", "d");
    const next = named("d", "c", "b", "a");
    const editing = new Set(["c", "d"]);

    expect(holdEditingPositions(next, previous, editing)).toEqual(named("b", "c", "a", "d"));
  });

  it("leaves the list untouched when nothing is under edit", () => {
    const next = named("a", "b");

    expect(holdEditingPositions(next, named("x"), new Set())).toEqual(named("a", "b"));
  });

  it("ignores an edited memo that is not in the list", () => {
    const next = named("a", "b");
    const editing = new Set(["gone"]);

    expect(holdEditingPositions(next, named("gone", "a", "b"), editing)).toEqual(named("a", "b"));
  });

  it("ignores edits whose memo was not visible before", () => {
    const previous = named("a", "b");
    const next = named("fresh", "a", "b");
    const editing = new Set(["fresh"]);

    expect(holdEditingPositions(next, previous, editing)).toEqual(named("fresh", "a", "b"));
  });
});
