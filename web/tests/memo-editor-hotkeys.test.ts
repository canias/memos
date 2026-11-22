import type { Editor } from "@usememos/editor";
import { describe, expect, it, vi } from "vitest";
import { memoEditorHotkeys } from "@/components/MemoEditor/edit/hotkeys";

describe("memoEditorHotkeys save", () => {
  it.each(["Mod-s", "Mod-Enter", "Ctrl-Enter"])("saves the memo on %s and consumes the key", (key) => {
    const onSave = vi.fn();
    const handler = memoEditorHotkeys({ onSave }).keymap?.[key];
    expect(handler).toBeDefined();
    expect(handler?.({ editor: {} as Editor })).toBe(true);
    expect(onSave).toHaveBeenCalledOnce();
  });
});
