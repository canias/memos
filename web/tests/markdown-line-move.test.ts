import { describe, expect, it } from "vitest";
import { moveMarkdownLineAt } from "@/utils/markdown-line-actions";

describe("moveMarkdownLineAt", () => {
  it("moves a paragraph up over its neighbor and follows the caret", () => {
    const markdown = "one\n\ntwo\n\nthree";
    const result = moveMarkdownLineAt(markdown, 6, -1);

    expect(result?.markdown).toBe("two\n\none\n\nthree");
    expect(markdown.slice(5, 8)).toBe("two");
    expect(result?.caret).toBe(1);
  });

  it("moves a top-level paragraph down and follows the caret", () => {
    const markdown = "one\n\ntwo\n\nthree";
    const result = moveMarkdownLineAt(markdown, 2, 1);

    expect(result?.markdown).toBe("two\n\none\n\nthree");
    expect(result?.caret).toBe(7);
  });

  it("swaps whole list items including their nested children", () => {
    const markdown = [
      "- done the todo-list feature",
      "- task with sub-features:",
      "  - drag and drop",
      "  - manual sorting",
      "- newest task",
    ].join("\n");
    const caret = markdown.indexOf("task with sub-features");
    const result = moveMarkdownLineAt(markdown, caret, -1);

    expect(result?.markdown).toBe(
      ["- task with sub-features:", "  - drag and drop", "  - manual sorting", "- done the todo-list feature", "- newest task"].join("\n"),
    );
  });

  it("moves a nested item within its own list", () => {
    const markdown = ["- alpha", "  - one", "  - two", "- beta"].join("\n");
    const caret = markdown.indexOf("two");
    const result = moveMarkdownLineAt(markdown, caret, -1);

    expect(result?.markdown).toBe(["- alpha", "  - two", "  - one", "- beta"].join("\n"));
  });

  it("supports task markers kept byte for byte", () => {
    const markdown = "- [x] done item\n- [/] in progress";
    const caret = markdown.indexOf("in progress");
    const result = moveMarkdownLineAt(markdown, caret, -1);

    expect(result?.markdown).toBe("- [/] in progress\n- [x] done item");
  });

  it("returns null when the whole paragraph is the only block and nothing sits above", () => {
    const markdown = "only paragraph";

    expect(moveMarkdownLineAt(markdown, 1, -1)).toBeNull();
  });

  it("returns null when a soft-wrapped line cannot move out of its paragraph", () => {
    const markdown = "two soft lines\nin one paragraph";

    // Soft-wrapped lines stay inside their paragraph; the whole paragraph is
    // the unit, and a mid-paragraph line has no sibling to swap with.
    expect(moveMarkdownLineAt(markdown, 5, -1)).toBeNull();
  });

  it("keeps blank lines between swapped blocks", () => {
    const markdown = "first\n\nsecond";
    const caret = markdown.indexOf("second");
    const result = moveMarkdownLineAt(markdown, caret, -1);

    expect(result?.markdown).toBe("second\n\nfirst");
  });
});
