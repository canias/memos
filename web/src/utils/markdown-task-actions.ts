import { lineTable, visit } from "@usememos/editor";
import { parseMemoAst } from "@/lib/memo-ast";

interface SourceRange {
  start: number;
  end: number;
}

interface MarkdownEdit extends SourceRange {
  replacement: string;
}

interface ParsedTaskItem {
  checked: boolean;
  checkboxMarker: SourceRange;
}

// A task item's first line: the quote markers and list markers before it (a list item may
// start with another list's marker), its own marker, then the box.
const TASK_LINE_REGEXP = /^((?:[ \t]*>)*(?:[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)+)\[([ xX])\]/;

function parseTaskItems(markdown: string): ParsedTaskItem[] {
  const lines = lineTable(markdown);
  const tasks: ParsedTaskItem[] = [];

  visit(parseMemoAst(markdown), (node) => {
    if (node.type !== "listItem" || !node.task || !node.lines) {
      return;
    }

    const lineStart = lines.starts[node.lines.start - 1];
    const match = markdown.slice(lineStart, lines.ends[node.lines.start - 1]).match(TASK_LINE_REGEXP);
    if (!match) {
      return;
    }

    const markerStart = lineStart + match[1].length + 1;
    tasks.push({
      checked: node.checked,
      checkboxMarker: {
        start: markerStart,
        end: markerStart + 1,
      },
    });
  });

  return tasks;
}

function applyMarkdownEdits(markdown: string, edits: MarkdownEdit[]): string {
  if (edits.length === 0) {
    return markdown;
  }

  const sortedEdits = [...edits].sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const edit of sortedEdits) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > markdown.length || edit.start < previousEnd) {
      return markdown;
    }
    previousEnd = edit.end;
  }

  let nextMarkdown = markdown;
  for (let index = sortedEdits.length - 1; index >= 0; index--) {
    const edit = sortedEdits[index];
    nextMarkdown = `${nextMarkdown.slice(0, edit.start)}${edit.replacement}${nextMarkdown.slice(edit.end)}`;
  }
  return nextMarkdown;
}

function setAllTaskMarkers(markdown: string, checked: boolean): string {
  const marker = checked ? "x" : " ";
  const edits = parseTaskItems(markdown)
    .filter((task) => task.checked !== checked)
    .map<MarkdownEdit>((task) => ({
      start: task.checkboxMarker.start,
      end: task.checkboxMarker.end,
      replacement: marker,
    }));

  return applyMarkdownEdits(markdown, edits);
}

export function uncheckAllTasks(markdown: string): string {
  return setAllTaskMarkers(markdown, false);
}

export function checkAllTasks(markdown: string): string {
  return setAllTaskMarkers(markdown, true);
}

/** The four states a cycle can leave a line in. */
export type TaskState = "todo" | "doing" | "done" | "plain";

export interface LineTransformResult {
  markdown: string;
  /** The new caret offset in the transformed markdown. */
  caret: number;
  /** The state the line was left in. */
  state: TaskState;
}

// Matches a line that already carries list markers: quote markers, then list
// markers, then an optional task box and the text after it.
const LIST_LINE_REGEXP = /^((?:[ \t]*>)*(?:[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)+)(\[([ xX/])\][ \t]?)?(.*)$/;

/** Whether a caret on the given 1-based source line sits inside a fenced or indented code block. */
function isInsideCodeBlock(markdown: string, oneBasedLine: number): boolean {
  let inside = false;
  visit(parseMemoAst(markdown), (node) => {
    if (node.type !== "codeBlock") {
      return undefined;
    }
    if (!node.lines) {
      return false;
    }
    if (node.lines.start <= oneBasedLine && oneBasedLine <= node.lines.end) {
      inside = true;
    }
    return false;
  });
  return inside;
}

const NEXT_STATE: Record<string, TaskState> = { " ": "doing", "/": "done", x: "plain", X: "plain" };
const PREVIOUS_STATE: Record<string, TaskState> = { " ": "plain", "/": "todo", x: "doing", X: "doing" };
const STATE_MARKER: Record<TaskState, string> = { todo: " ", doing: "/", done: "x", plain: " " };

/**
 * Cycles the task state of the source line holding `caret`: a task line moves
 * one step through todo, doing, done, then back to a plain list item, and a
 * plain list line becomes a todo. `direction` -1 walks the same cycle backwards.
 * The caret keeps its offset into the line's text. Returns null when the line is
 * not a list or task line, so callers can fall back to a whole-block toggle.
 */
export function cycleTaskLineAt(markdown: string, caret: number, direction: 1 | -1 = 1): LineTransformResult | null {
  const lines = lineTable(markdown);
  const tableIndex = lines.starts.findIndex((lineStart, index) => lineStart <= caret && caret <= lines.ends[index]);
  if (tableIndex === -1) {
    return null;
  }

  // A line inside a fenced code block may look like a task but stays code.
  if (isInsideCodeBlock(markdown, tableIndex + 1)) {
    return null;
  }

  const lineStart = lines.starts[tableIndex];
  const lineEnd = lines.ends[tableIndex];
  const line = markdown.slice(lineStart, lineEnd);
  const match = line.match(LIST_LINE_REGEXP);

  // A plain paragraph line has no list marker: it starts the cycle as a bullet todo.
  // Matching the list regexp with an empty prefix keeps the same rebuild path below.
  const plainLine = match ? null : line.match(/^((?:[ \t]*>)*[ \t]*)(\[([ xX/])\][ \t]?)?(.*)$/);
  if (!match && !plainLine) {
    return null;
  }
  const parsed = match ?? plainLine;
  const prefix = match ? parsed![1] : `${parsed![1]}- `;
  const box = parsed![2];
  const boxMarker = parsed![3];
  const text = parsed![4];
  // Where the text starts on the original line (before any marker added for a plain line).
  const originalPrefix = match ? parsed![1] : plainLine![1];
  const oldTextStart = lineStart + originalPrefix.length + (box?.length ?? 0);

  // A plain line starts at todo going forward; going backward it wraps to done.
  const state: TaskState = box ? (direction === 1 ? NEXT_STATE : PREVIOUS_STATE)[boxMarker] : direction === 1 ? "todo" : "done";
  const marker = STATE_MARKER[state];
  // Done goes back to plain text: the bullet is dropped too, so no dash is left behind.
  const plainPrefix = match ? parsed![1].replace(/[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+$/, "") : originalPrefix;
  const rebuiltLine = state === "plain" ? `${plainPrefix}${text}` : `${prefix}[${marker}] ${text}`;

  // Replace the exact line span; lineTable's end is before the line ending,
  // so the ending and the rest of the document carry over untouched.
  const next = markdown.slice(0, lineStart) + rebuiltLine + markdown.slice(lineEnd);

  // The caret keeps its offset into the text after the box, so changing the
  // box does not move it.
  const newTextStart = state === "plain" ? lineStart + plainPrefix.length : lineStart + prefix.length + 4;
  const offsetInText = Math.max(0, Math.min(caret, lineEnd) - oldTextStart);

  return {
    markdown: next,
    caret: newTextStart + offsetInText,
    state,
  };
}
