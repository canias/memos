import { useCallback } from "react";
import { useDevicePreferences } from "@/hooks/useDevicePreferences";
import type { PreviewMediaItem } from "@/utils/media-item";

interface UseMemoHandlersOptions {
  readonly: boolean;
  openEditor: () => void;
  openPreview: (items: string | string[] | PreviewMediaItem[], index?: number) => void;
}

export const useMemoHandlers = (options: UseMemoHandlersOptions) => {
  const { readonly, openEditor, openPreview } = options;
  const { doubleClickEdit, singleClickEdit } = useDevicePreferences();

  const handleMemoContentClick = useCallback(
    (e: React.MouseEvent) => {
      const targetEl = e.target as HTMLElement;
      if (targetEl.tagName === "IMG") {
        const linkElement = targetEl.closest("a");
        if (linkElement) return; // If image is inside a link, don't show preview
        const imgUrl = targetEl.getAttribute("src");
        if (imgUrl) openPreview(imgUrl);
        return;
      }
      // A single click edits the memo when that preference is on; the card focus ring
      // is set separately by the feed's click handler.
      // A tick on a task checkbox toggles that task; it is not a request to edit.
      if (targetEl.closest("input[type=checkbox], [data-task-checkbox]")) return;
      if (singleClickEdit && !readonly) {
        openEditor();
      }
    },
    [openPreview, singleClickEdit, readonly, openEditor],
  );

  const handleMemoContentDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readonly) return;
      if ((e.target as HTMLElement).closest("input[type=checkbox], [data-task-checkbox]")) return;
      if (doubleClickEdit && !singleClickEdit) {
        e.preventDefault();
        openEditor();
      }
    },
    [readonly, openEditor, doubleClickEdit, singleClickEdit],
  );

  return { handleMemoContentClick, handleMemoContentDoubleClick };
};
