import { type LineTable, lineTable, nodeChildren, type SourceLines, type TreeNode, visit } from "@usememos/editor";
import { parseMemoAst } from "@/lib/memo-ast";

interface SourceSpan {
  start: number;
  end: number;
}

export interface LineTransformResult {
  markdown: string;
  /** The new caret offset in the transformed markdown. */
  caret: number;
}

interface Movable {
  node: TreeNode;
  parent: TreeNode;
  span: SourceSpan;
}

/** Lines of one node: a root covers one span per child, every other node one optional span. */
const linesOfNode = (node: TreeNode): readonly SourceLines[] => {
  if (node.type === "root") {
    return node.lines;
  }
  return "lines" in node && node.lines ? [node.lines] : [];
};

/** The one optional line span of any node below the root. */
const subLineSpan = (node: TreeNode): SourceLines | undefined => {
  const lines: unknown = "lines" in node ? node.lines : undefined;
  return (Array.isArray(lines) ? lines[0] : lines) as SourceLines | undefined;
};

/** Char offsets of one 1-based inclusive line span. */
const charsOfLines = (span: SourceLines, table: LineTable): SourceSpan => ({
  start: table.starts[span.start - 1],
  end: table.ends[span.end - 1],
});

/** The 1-based source line an offset sits on, or null when it is out of the text. */
const lineIndexOf = (offset: number, table: LineTable): number | null => {
  for (let index = 0; index < table.starts.length; index++) {
    if (offset >= table.starts[index] && offset <= table.ends[index]) {
      return index + 1;
    }
  }
  return null;
};

/** Char offsets of the whole subtree of a node, or null when no source lines are known. */
const subtreeSpan = (node: TreeNode, table: LineTable): SourceSpan | null => {
  let start: number | null = null;
  let end: number | null = null;
  visit(node, (descendant) => {
    for (const span of linesOfNode(descendant)) {
      const chars = charsOfLines(span, table);
      if (start === null || chars.start < start) start = chars.start;
      if (end === null || chars.end > end) end = chars.end;
    }
  });
  return start === null || end === null ? null : { start, end };
};

/**
 * Source char span of a node as its parent maps it: a root child takes the
 * root's per-child line span; a deeper node carries its own subtree span.
 */
const spanOfNode = (node: TreeNode, parent: TreeNode, table: LineTable): SourceSpan | null => {
  if (parent.type === "root") {
    const index = nodeChildren(parent).indexOf(node);
    const lineSpan = index >= 0 ? parent.lines[index] : subLineSpan(node);
    return lineSpan ? charsOfLines(lineSpan, table) : subtreeSpan(node, table);
  }
  return subtreeSpan(node, table);
};

/**
 * Finds the movable unit for a source line: the deepest list item covering the
 * line, or a top-level block such as a paragraph or code block. Its parent
 * gives the siblings the unit can swap with.
 */
const findMovable = (markdown: string, caretLine: number, table: LineTable): Movable | null => {
  const root = parseMemoAst(markdown);
  const rootChildren = nodeChildren(root);
  let best: Movable | null = null;

  visit(root, (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    if (!parent) {
      return undefined;
    }
    const isListItem = node.type === "listItem";
    const isRootChild = parent === root;
    if (!isListItem && !isRootChild) {
      return undefined;
    }

    // Root children keep their source mapping on the root; a list item maps
    // only its own marker line, so nested lines join through the subtree span.
    const lineSpan = isRootChild ? root.lines[rootChildren.indexOf(node)] : subLineSpan(node);
    if (!lineSpan) {
      return undefined;
    }
    if (caretLine < lineSpan.start || caretLine > lineSpan.end) {
      return false;
    }

    const itemSpan = isListItem ? subtreeSpan(node, table) : charsOfLines(lineSpan, table);
    if (!itemSpan) {
      return undefined;
    }
    best = { node, parent, span: itemSpan };
    return undefined;
  });

  return best;
};

/**
 * Moves the block or list item holding `caret` up or down, swapping its whole
 * subtree (nested list items included) with the previous or next sibling. The
 * caret follows the moved subtree, keeping its offset into its text. Returns
 * null when the line has no sibling to swap with.
 */
export function moveMarkdownLineAt(markdown: string, caret: number, delta: -1 | 1): LineTransformResult | null {
  const table = lineTable(markdown);
  const caretLine = lineIndexOf(caret, table);
  if (caretLine === null) {
    return null;
  }

  const movable = findMovable(markdown, caretLine, table);
  if (!movable || !movable.span) {
    return null;
  }

  const siblings = nodeChildren(movable.parent);
  const index = siblings.indexOf(movable.node);
  if (index === -1) {
    return null;
  }
  const sibling = delta === -1 ? siblings[index - 1] : siblings[index + 1];
  if (!sibling) {
    return null;
  }
  // A root child's source mapping lives on the root, so its sibling takes the
  // root's span; deeper siblings carry their own subtree spans.
  const siblingSpan = spanOfNode(sibling, movable.parent, table);
  if (!siblingSpan) {
    return null;
  }

  // Region order now: [first ... gap ... second]. Moving swaps the two
  // subtree spans byte for byte, so each stays intact and untouched
  // regions keep their offsets.
  const first = delta === -1 ? siblingSpan : movable.span;
  const second = delta === -1 ? movable.span : siblingSpan;
  const gap = markdown.slice(first.end, second.start);
  const next =
    markdown.slice(0, first.start) +
    markdown.slice(second.start, second.end) +
    gap +
    markdown.slice(first.start, first.end) +
    markdown.slice(second.end);

  const inMoved = caret >= movable.span.start && caret <= movable.span.end;
  // After the swap the moved subtree starts at the sibling's slot: for up it
  // replaces the sibling in place; for down it moves past the sibling span
  // and the gap between them.
  const movedOffset = delta === -1 ? first.start : first.start + (second.end - second.start) + gap.length;
  const caretNew = inMoved ? movedOffset + (caret - movable.span.start) : caret;

  return {
    markdown: next,
    caret: Math.min(Math.max(0, caretNew), next.length),
  };
}
