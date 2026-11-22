import { type Block, type Editor, type Extension, inlineText, isTextBlock, lineTable, visit } from "@usememos/editor";
import { parseMemoAst } from "@/lib/memo-ast";
import { parseMemoMarkdown } from "@/lib/memo-markdown";
import { moveMarkdownLineAt } from "@/utils/markdown-line-actions";
import { cycleTaskLineAt } from "@/utils/markdown-task-actions";

interface CaretOpContext {
  editor: Editor;
  markdown: string;
  blocks: readonly Block[];
  blockIndex: number;
  selection: { anchor: { block: number; offset: number }; focus: { block: number; offset: number } };
}

interface CaretOpResult {
  markdown: string;
  /** Where the caret lands after the document reset. */
  caret: { kind: "same" } | { kind: "offset"; offset: number } | { kind: "block"; block: number };
}

/** The index of the caret's list item among all list items of the document, or null when it is not on one. */
const itemIndexAtBlock = (blocks: readonly Block[], blockIndex: number): number | null => {
  const block = blocks[blockIndex];
  if (block?.type !== "listItem") {
    return null;
  }
  let index = 0;
  for (let cursor = 0; cursor < blockIndex; cursor++) {
    if (blocks[cursor].type === "listItem") index++;
  }
  return index;
};

/** The 1-based marker lines of every list item, in document order. Nested items are their own entries. */
const itemMarkerLines = (markdown: string): number[] => {
  const lines: number[] = [];
  visit(parseMemoAst(markdown), (node) => {
    if (node.type === "listItem" && node.lines) {
      lines.push(node.lines.start);
    }
    return undefined;
  });
  return lines;
};

/** The block index of the k-th list item of a flat block list, or null when fewer items exist. */
const blockIndexOfItem = (blocks: readonly Block[], itemIndex: number): number | null => {
  let seen = 0;
  for (let cursor = 0; cursor < blocks.length; cursor++) {
    if (blocks[cursor].type === "listItem") {
      if (seen === itemIndex) return cursor;
      seen++;
    }
  }
  return null;
};

/** The 1-based source line an offset sits on, or 0 when it is outside the text. */
const lineIndexOf = (markdown: string, offset: number): number => {
  const table = lineTable(markdown);
  for (let index = 0; index < table.starts.length; index++) {
    if (offset >= table.starts[index] && offset <= table.ends[index]) {
      return index + 1;
    }
  }
  return 0;
};

/** Text length of one block's content, 0 for blocks without inline content. */
const contentLength = (block: Block | undefined): number => (block && isTextBlock(block) ? inlineText(block.content).length : 0);

/**
 * Cycles the task state of the list item under the caret: exactly at source offsets in
 * source mode, and through the item order in rich mode, where box markers keep every
 * block's offsets so the selection can survive the reset. A caret on other blocks turns
 * them into task items, as the toolbar toggle does.
 */
const cycleTaskOp = ({
  editor,
  markdown,
  blocks,
  blockIndex,
  selection,
  direction,
}: CaretOpContext & { direction: 1 | -1 }): CaretOpResult | null => {
  if (editor.mode === "source") {
    const result = cycleTaskLineAt(markdown, selection.anchor.offset, direction);
    return result ? { markdown: result.markdown, caret: { kind: "offset", offset: result.caret } } : null;
  }

  const itemIndex = itemIndexAtBlock(blocks, blockIndex);
  if (itemIndex === null) {
    return editor.commands.toggleTaskList() ? { markdown: editor.getMarkdown(), caret: { kind: "same" } } : null;
  }

  const markerLine = itemMarkerLines(markdown)[itemIndex];
  if (markerLine === undefined) {
    return null;
  }
  const result = cycleTaskLineAt(markdown, lineTable(markdown).starts[markerLine - 1], direction);
  return result ? { markdown: result.markdown, caret: { kind: "same" } } : null;
};

/**
 * Moves the list item under the caret up or down while the rest of the memo reshuffles
 * with its own subtree. The caret follows the moved item: its content keeps the same
 * offsets, so only the block slot has to be re-found in the re-parsed document.
 */
const moveLineOp = ({
  editor,
  markdown,
  blocks,
  blockIndex,
  delta,
  selection,
}: CaretOpContext & { delta: -1 | 1 }): CaretOpResult | null => {
  if (editor.mode === "source") {
    const result = moveMarkdownLineAt(markdown, selection.anchor.offset, delta);
    return result ? { markdown: result.markdown, caret: { kind: "offset", offset: result.caret } } : null;
  }

  const itemIndex = itemIndexAtBlock(blocks, blockIndex);
  if (itemIndex === null) {
    return null;
  }
  const markerLine = itemMarkerLines(markdown)[itemIndex];
  if (markerLine === undefined) {
    return null;
  }
  const result = moveMarkdownLineAt(markdown, lineTable(markdown).starts[markerLine - 1], delta);
  if (!result) {
    return null;
  }

  // The result caret sits at the start of the moved item's marker line; the item
  // holding that line is the caret's item in the re-parsed document.
  const postMarkerLine = lineIndexOf(result.markdown, result.caret);
  const postItemIndex = postMarkerLine ? itemMarkerLines(result.markdown).indexOf(postMarkerLine) : -1;
  const postBlockIndex = postItemIndex >= 0 ? blockIndexOfItem(parseMemoMarkdown(result.markdown).blocks, postItemIndex) : null;
  return postBlockIndex === null
    ? { markdown: result.markdown, caret: { kind: "same" } }
    : { markdown: result.markdown, caret: { kind: "block", block: postBlockIndex } };
};

/**
 * Toggles a bullet on the caret line: a plain line gets "- ", a bullet line loses it. Task
 * boxes stay where they are, so the shortcut only changes the list marker.
 */
export const toggleBulletAt = (markdown: string, caret: number): { markdown: string; caret: number } | null => {
  const lines = lineTable(markdown);
  const index = lines.starts.findIndex((start, i) => start <= caret && caret <= lines.ends[i]);
  if (index === -1) return null;
  const lineStart = lines.starts[index];
  const lineEnd = lines.ends[index];
  const line = markdown.slice(lineStart, lineEnd);
  const bullet = line.match(/^((?:[ \t]*>)*[ \t]*)([-*+])[ \t]+/);
  if (bullet) {
    const removed = bullet[0].length - bullet[1].length;
    const next = bullet[1] + line.slice(bullet[0].length);
    return {
      markdown: markdown.slice(0, lineStart) + next + markdown.slice(lineEnd),
      caret: Math.max(lineStart + bullet[1].length, caret - removed),
    };
  }
  const indent = line.match(/^((?:[ \t]*>)*[ \t]*)/)?.[1] ?? "";
  const next = indent + "- " + line.slice(indent.length);
  return { markdown: markdown.slice(0, lineStart) + next + markdown.slice(lineEnd), caret: caret + 2 };
};

/** Runs one caret op and, on success, resets the document and re-anchors the selection. */
const runCaretOp = (
  editor: Editor,
  op: (context: CaretOpContext) => CaretOpResult | null,
  onMarkdownChange?: (markdown: string) => void,
): boolean => {
  const markdown = editor.getMarkdown();
  const selection = editor.selectionToJSON();
  const result = op({
    editor,
    markdown,
    blocks: editor.state.doc.blocks,
    blockIndex: selection.anchor.block,
    selection,
  });
  if (!result) {
    return false;
  }
  editor.setMarkdown(result.markdown);
  // setMarkdown emits no change, so tell the host the document moved; otherwise a save writes the old text.
  onMarkdownChange?.(result.markdown);
  if (result.caret.kind === "offset") {
    editor.setSelection({
      anchor: { block: selection.anchor.block, offset: result.caret.offset },
      focus: { block: selection.focus.block, offset: result.caret.offset },
    });
  } else if (result.caret.kind === "block") {
    editor.setSelection({
      anchor: {
        block: result.caret.block,
        offset: Math.min(selection.anchor.offset, contentLength(editor.state.doc.blocks[result.caret.block])),
      },
      focus: {
        block: result.caret.block,
        offset: Math.min(selection.focus.offset, contentLength(editor.state.doc.blocks[result.caret.block])),
      },
    });
  } else {
    editor.setSelection(selection);
  }
  editor.commands.scrollIntoView();
  return true;
};

/**
 * The editing hotkeys. Ctrl+Y cycles the caret line's task state forward through todo,
 * doing, done and a plain item (Ctrl+Shift+Y and Ctrl+ArrowLeft go backward); Ctrl/⌘+. toggles
 * a bullet; Alt+ArrowUp/Down moves the line or list item; Ctrl/⌘+S and Ctrl/⌘+Enter save the memo.
 * The earlier extension wins over the editor's default keys.
 */
export const memoEditorHotkeys = ({
  onSave,
  onMarkdownChange,
}: {
  onSave: () => void;
  onMarkdownChange?: (markdown: string) => void;
}): Extension => ({
  name: "memoHotkeys",
  keymap: {
    // Ctrl+Y cycles the caret line forward (plain → todo → doing → done → plain); Ctrl+Shift+Y and
    // Ctrl+ArrowLeft/Right cycle it backward or forward respectively.
    "Ctrl-y": ({ editor }) => runCaretOp(editor, (context) => cycleTaskOp({ ...context, direction: 1 }), onMarkdownChange),
    "Ctrl-Y": ({ editor }) => runCaretOp(editor, (context) => cycleTaskOp({ ...context, direction: -1 }), onMarkdownChange),
    "Ctrl-ArrowRight": ({ editor }) => runCaretOp(editor, (context) => cycleTaskOp({ ...context, direction: 1 }), onMarkdownChange),
    "Ctrl-ArrowLeft": ({ editor }) => runCaretOp(editor, (context) => cycleTaskOp({ ...context, direction: -1 }), onMarkdownChange),
    // Ctrl/⌘+. toggles a bullet on the caret line, the same way the task cycle edits a line.
    "Mod-.": ({ editor }) => {
      const markdown = editor.getMarkdown();
      const selection = editor.selectionToJSON();
      const result = toggleBulletAt(markdown, selection.anchor.offset);
      if (!result) return true;
      editor.setMarkdown(result.markdown);
      onMarkdownChange?.(result.markdown);
      editor.setSelection({
        anchor: { block: selection.anchor.block, offset: result.caret },
        focus: { block: selection.focus.block, offset: result.caret },
      });
      return true;
    },
    "Mod-s": () => {
      onSave();
      return true;
    },
    // Mod is Cmd on macOS and Ctrl elsewhere; Ctrl+Enter saves on macOS too.
    "Mod-Enter": () => {
      onSave();
      return true;
    },
    "Ctrl-Enter": () => {
      onSave();
      return true;
    },
    "Alt-ArrowUp": ({ editor }) => runCaretOp(editor, (context) => moveLineOp({ ...context, delta: -1 }), onMarkdownChange),
    "Alt-ArrowDown": ({ editor }) => runCaretOp(editor, (context) => moveLineOp({ ...context, delta: 1 }), onMarkdownChange),
  },
});
