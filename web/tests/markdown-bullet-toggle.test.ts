import { describe, expect, it } from "vitest";
import { toggleBulletAt } from "@/components/MemoEditor/edit/hotkeys";

describe("toggleBulletAt", () => {
  it("adds a bullet to a plain line and keeps the caret on its text", () => {
    expect(toggleBulletAt("hello", 2)).toEqual({ markdown: "- hello", caret: 4 });
  });

  it("removes the bullet from a list line", () => {
    expect(toggleBulletAt("- hello", 4)).toEqual({ markdown: "hello", caret: 2 });
  });

  it("only touches the caret line", () => {
    expect(toggleBulletAt("a\nb", 2)).toEqual({ markdown: "a\n- b", caret: 4 });
  });
});
