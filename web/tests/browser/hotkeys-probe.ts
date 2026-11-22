import { Editor } from "@usememos/editor";
import "@usememos/editor/style.css";
import "/src/index.css";
import { MEMO_EDITOR_THEME } from "/src/lib/memo-markdown.ts";
import { buildEditorExtensions } from "/src/components/MemoEditor/edit/extensions.ts";

const log: string[] = [];
(window as unknown as { __log: string[] }).__log = log;

const editor = new Editor({
  element: document.getElementById("rich")!,
  mode: "rich",
  content: "- one\n- two\n- three",
  theme: MEMO_EDITOR_THEME,
  extensions: buildEditorExtensions({
    getTags: () => [],
    onFiles: () => {},
    emojiLabel: "emoji",
    onSave: () => log.push("save"),
    onMarkdownChange: (md) => log.push("md:" + md.replace(/\n/g, "|")),
  }),
});
(window as unknown as { __editor: Editor }).__editor = editor;
