import { type Extension } from "@usememos/editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildEditorExtensions } from "@/components/MemoEditor/edit/extensions";
import { MemoMarkdown } from "@/components/MemoEditor/MemoMarkdown";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { useSourceMode } from "@/hooks/useSourceMode";
import { showErrorToast } from "@/lib/toast";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

const AUTOSAVE_DELAY_MS = 800;

interface MemoInlineEditorProps {
  memo: Memo;
  /** Called when editing ends through Escape; a saved change always landed first. */
  onDone: () => void;
}

/**
 * Edits the memo's body right inside the card: the same rendered Markdown turns editable in
 * place with no composer chrome, changes save with a short debounce, and an edit still in
 * flight when the card unmounts (a filter or a day changed) saves on the way out. Work is
 * never lost, and Save needs no ceremony.
 */
const MemoInlineEditor = ({ memo, onDone }: MemoInlineEditorProps) => {
  const t = useTranslate();
  const { mutate: updateMemo } = useUpdateMemo(memo.name);
  const [mode] = useSourceMode();
  const [content, setContent] = useState(memo.content);
  const savedRef = useRef(memo.content);
  const latestRef = useRef(memo.content);
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = latestRef.current;
    if (next === savedRef.current) return;
    latestRef.current = savedRef.current;
    updateMemo(
      { update: { name: memo.name, content: next }, updateMask: ["content", "update_time"] },
      {
        onSuccess: () => {
          savedRef.current = next;
        },
        onError: () => {
          // Typed work stays in the editor for another debounced save try.
          latestRef.current = next;
          showErrorToast(t("memo.inline-save-failed"));
        },
      },
    );
  }, [memo.name, t, updateMemo]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // The card left the screen — a filter, day or route changed while the edit was
  // open. Whatever was typed saves on the way out.
  useEffect(() => () => flushRef.current(), []);

  // One extension set for the editor's lifetime; the callbacks read the latest
  // flush through the ref above.
  const extensions = useMemo<Extension[]>(() => {
    const base = buildEditorExtensions({
      getTags: () => [],
      onFiles: () => undefined,
      emojiLabel: "",
      onSave: () => flushRef.current(),
    });
    return [
      ...base,
      {
        name: "inlineEditorExit",
        keymap: {
          Escape: () => {
            flushRef.current();
            doneRef.current();
            return true;
          },
        },
      },
    ];
  }, []);

  return (
    <div data-slot="memo-inline-editor" className="w-full">
      <MemoMarkdown
        value={content}
        editable
        mode={mode === "source" ? "source" : "rich"}
        placeholder={t("memo.inline-edit-placeholder")}
        attachments={memo.attachments}
        extensions={extensions}
        onChange={(markdown) => {
          setContent(markdown);
          latestRef.current = markdown;
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => flushRef.current(), AUTOSAVE_DELAY_MS);
        }}
        className="memo-inline-editor-root"
      />
    </div>
  );
};

export default MemoInlineEditor;
