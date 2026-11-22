/** Memos with a live editing surface right now, keyed by resource name. */
const editingNames = new Set<string>();

/**
 * Marks a memo as being edited (in any surface) or clears the mark. The memo feed holds
 * an editing memo at the position it showed when the edit started, so typing cannot
 * reshuffle other cards around the caret.
 */
export const setMemoEditing = (name: string, editing: boolean): void => {
  if (editing) {
    editingNames.add(name);
  } else {
    editingNames.delete(name);
  }
};

/** Names of every memo under edit at the moment. */
export const memoNamesEditing = (): ReadonlySet<string> => editingNames;

/**
 * Reorders `next` so every memo under edit keeps the position it had in `previous`:
 * the card under the caret must not move while its content saves, and others slide
 * around it. Memos that left the list (archived, filtered out) step aside.
 */
export const holdEditingPositions = <T extends { name: string }>(
  next: readonly T[],
  previous: readonly T[],
  editing: ReadonlySet<string>,
): T[] => {
  if (editing.size === 0) return [...next];
  const result = next.slice();
  for (const name of editing) {
    const previousIndex = previous.findIndex((memo) => memo.name === name);
    if (previousIndex < 0) continue;
    const index = result.findIndex((memo) => memo.name === name);
    if (index < 0 || index === previousIndex) continue;
    const [memo] = result.splice(index, 1);
    result.splice(Math.min(previousIndex, result.length), 0, memo);
  }
  return result;
};
