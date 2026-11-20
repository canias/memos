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
 * Requests for a card to start its lean in-place edit, made from outside the card (the
 * feed's `e` hotkey). The card consumes its request when it sees it.
 */
const leanEditRequests = new Set<string>();
const leanEditListeners = new Set<() => void>();

const emitLeanEditRequests = () => {
  for (const listener of leanEditListeners) listener();
};

/** Asks the card to turn its body into its editor. */
export const requestLeanEdit = (name: string): void => {
  leanEditRequests.add(name);
  emitLeanEditRequests();
};

/** Takes the card's pending request, if any; the card then opens its editor. */
export const consumeLeanEditRequest = (name: string): boolean => {
  const requested = leanEditRequests.delete(name);
  if (requested) emitLeanEditRequests();
  return requested;
};

/** Subscribes to request changes; the snapshot is whether the named card has one. */
export const subscribeLeanEditRequests = (listener: () => void): (() => void) => {
  leanEditListeners.add(listener);
  return () => leanEditListeners.delete(listener);
};

export const hasLeanEditRequest = (name: string): boolean => leanEditRequests.has(name);

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
