import { describe, expect, it } from "vitest";
import { cycleTaskLineAt, type TaskState } from "@/utils/markdown-task-actions";

describe("cycleTaskLineAt", () => {
  it("cycles a todo line to doing and keeps the caret", () => {
    const markdown = "- [ ] ship the release";
    const result = cycleTaskLineAt(markdown, 15);

    expect(result).toEqual({ markdown: "- [/] ship the release", caret: 15, state: "doing" });
  });

  it("cycles a doing line to done", () => {
    const markdown = "- [/] ship the release";
    const result = cycleTaskLineAt(markdown, 15);

    expect(result).toEqual({ markdown: "- [x] ship the release", caret: 15, state: "done" });
  });

  it("cycles a done line back to a plain list item", () => {
    const markdown = "- [x] ship the release";
    const result = cycleTaskLineAt(markdown, 15);

    expect(result).toEqual({ markdown: "ship the release", caret: 9, state: "plain" });
  });

  it("cycles a plain list item to a todo", () => {
    const markdown = "- ship the release";
    const result = cycleTaskLineAt(markdown, 7);

    expect(result).toEqual({ markdown: "- [ ] ship the release", caret: 11, state: "todo" });
  });

  it("cycles inside quoted and nested lists", () => {
    const markdown = "> - [ ] quoted todo";
    const result = cycleTaskLineAt(markdown, 10);

    expect(result?.markdown).toBe("> - [/] quoted todo");
    expect(result?.state).toBe("doing");
  });

  it("keeps the caret in the text when the caret sits inside the box", () => {
    const markdown = "- [x] done";
    const result = cycleTaskLineAt(markdown, 2);

    expect(result?.markdown).toBe("done");
    expect(result?.caret).toBe(0);
  });

  it("turns a plain line into a todo first, then cycles through doing, done and back to plain", () => {
    const first = cycleTaskLineAt("Just a paragraph", 5);
    expect(first?.markdown).toBe("- [ ] Just a paragraph");
    expect(first?.state).toBe("todo");

    const second = cycleTaskLineAt(first!.markdown, first!.caret);
    expect(second?.markdown).toBe("- [/] Just a paragraph");
    expect(second?.state).toBe("doing");

    const third = cycleTaskLineAt(second!.markdown, second!.caret);
    expect(third?.markdown).toBe("- [x] Just a paragraph");
    expect(third?.state).toBe("done");

    // A done line returns to plain text: no bullet is left behind.
    const fourth = cycleTaskLineAt(third!.markdown, third!.caret);
    expect(fourth?.markdown).toBe("Just a paragraph");
    expect(fourth?.state).toBe("plain");
  });

  it("returns null for code lines", () => {
    const markdown = "```\n- [ ] not a real task\n```";

    expect(cycleTaskLineAt(markdown, 8)).toBeNull();
  });

  it("round-trips a full cycle through all four states", () => {
    let content = "- [ ] step";
    let caret = 7;
    const states: (TaskState | undefined)[] = [];
    for (const expectedState of ["doing", "done", "plain", "todo"] as const) {
      const result = cycleTaskLineAt(content, caret);
      content = result?.markdown ?? content;
      caret = result?.caret ?? caret;
      states.push(result?.state);
      expect(result?.state).toBe(expectedState);
    }
    expect(content).toBe("- [ ] step");
  });
});
