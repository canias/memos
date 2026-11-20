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
const cycleTaskOp = ({ editor, markdown, blocks, blockIndex, selection }: CaretOpContext): CaretOpResult | null => {
  if (editor.mode === "source") {
    const result = cycleTaskLineAt(markdown, selection.anchor.offset);
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
  const result = cycleTaskLineAt(markdown, lineTable(markdown).starts[markerLine - 1]);
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

/** Runs one caret op and, on success, resets the document and re-anchors the selection. */
const runCaretOp = (editor: Editor, op: (context: CaretOpContext) => CaretOpResult | null): boolean => {
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
 * The editing hotkeys. Ctrl+Enter cycles the caret line's task state through todo,
 * doing, done and a plain item; Alt+ArrowUp/Down moves the line or list item; Ctrl/⌘+S
 * (and ⌘+Enter) saves the memo. The earlier extension wins over the editor's default
 * keys, so Ctrl+Enter no longer submits on Windows and Linux.
 */
export const memoEditorHotkeys = ({ onSave }: { onSave: () => void }): Extension => ({
  name: "memoHotkeys",
  keymap: {
    "Ctrl-Enter": ({ editor }) => {
      runCaretOp(editor, cycleTaskOp);
      return true;
    },
    "Mod-s": () => {
      onSave();
      return true;
    },
    "Meta-Enter": () => {
      onSave();
      return true;
    },
    "Alt-ArrowUp": ({ editor }) => runCaretOp(editor, (context) => moveLineOp({ ...context, delta: -1 })),
    "Alt-ArrowDown": ({ editor }) => runCaretOp(editor, (context) => moveLineOp({ ...context, delta: 1 })),
  },
});
