# Plan: Unify memo edit entry points, fix todo-edit persistence, recurrence rollover and display

## Findings (verified in code)

- Two edit entry points render different editors:
  - A: Three-dot menu -> Edit: `web/src/components/MemoActionMenu/MemoActionMenu.tsx:127` -> `hooks.ts:80-82` -> `MemoView/components/MemoHeader.tsx:132` -> `MemoView.tsx:91-98` `openEditor` (sets `isEditing`, in-place).
  - B: Click body: `MemoView/hooks/useMemoHandlers.ts:15-46` -> `openEditor()`; `MemoBody.tsx:64-75` swaps body for `<MemoEditor>` (imported from `@/components/MemoEditor/MemoEditor`).
  - Both currently call the same `openEditor`, but the `MemoEditor` mode/props differ per path. Need to confirm during implementation what props differ (the screenshots show the body-click variant with a "Private" visibility toolbar and Cancel/Update, while the menu variant looks different).
- Ctrl+Shift+Enter (todo cycle) in `web/src/components/MemoEditor/edit/hotkeys.ts:226-229` calls `runCaretOp(...)`, which uses `editor.setMarkdown` (no change event) and reports the new text only via `onMarkdownChange` (`hotkeys.ts:182-183`). Ctrl/Cmd+Enter save (`hotkeys.ts:222-225`, `248-251`) calls `useMemoSave` (`edit/hooks/useMemoSave.ts:53-194`), which bails early when `!result.hasChanges` (`useMemoSave.ts:122`, `memoService.ts:159`). Root cause: the todo-created text is not registered as the editor's current content in the store before save compares it, so save sees "no changes" until another keystroke fires. UNVERIFIED: exact store field the save compares against; trace `useMemoSave` and `EditSession` (`edit/EditSession.tsx`) before changing.
- Preview checkbox toggle: `MemoEditor/MemoEditor.tsx:132` calls `updateMemo` with `updateMask: ["content","update_time"]`.
- Recurrence rollover is server-side: `server/api/memo_service_recurrence.go:20-50` (`rollRecurringMemo`), called from `server/api/memo_service.go:395-405` on any content update. It calls `core/schedule/completion.go` `AllTasksDone`, `ResetTasks`, `AdvanceMemoRecurrence`. When it rolls, it sets `update.CreatedTs` and rebuilds payload.
- Recurrence display: `MemoView/components/MemoHeader.tsx:59-60, 94-96` shows `data-slot="memo-recurrence"` only in the tooltip / conditional; `memoRecurrenceLabel.ts:20-25` builds the label. The screenshot shows the memo row with date but no recurrence label next to it, so the label is either not rendered in this card or hidden by layout. Verify before changing.

## Decisions to confirm with user before implementing

1. Unified editor: keep the in-card inline editor (the body-click variant, screenshot 1 style with Cancel/Update) as the single edit surface, and route the three-dot Edit action to it. Recommended: yes.
2. Ctrl+Shift+Enter: should it immediately mark the editor dirty / push content into the editor store (recommended), so a following Ctrl+Enter saves it.
3. Rollover trigger: recurrence rolls when all todos are done on save (edit mode) and on preview checkbox toggle (already the server path). Confirm that marking all done in preview should also roll the date (recommended: yes, same server path).
4. Recurrence label placement: show next to the date in the memo header (screenshot 3), e.g. `2 hours ago · Every 2 days`. Recommended: show the label always when `memo.recurrence` is set.

## Ordered tasks

1. Trace `useMemoSave`, `EditSession`, and the editor store to find the field save compares against. Add a dispatch in the caret-op path (`runCaretOp` callers in `hotkeys.ts`) so the store content is updated, and mark dirty. Add a unit test in `web/src/components/MemoEditor` covering: Ctrl+Shift+Enter then Ctrl+Enter sends the todo content.
2. Unify the entry points: make the three-dot Edit call the same inline `MemoEditor` edit path used by body click (`MemoView.tsx` `openEditor`, `MemoBody.tsx`). Remove any duplicate editor mount. Keep the `e` hotkey and feed edit-request registry working.
3. Verify server rollover on save: `server/api/memo_service_recurrence_test.go` covers `rollRecurringMemo`; add a case for "all done via edit-mode save" and "all done via preview toggle" if missing. No proto change expected.
4. Show recurrence in the header: render `memo.recurrence` label next to the date in `MemoHeader.tsx` (reuse `memoRecurrenceLabel.ts`). Add a web test if a header test exists.
5. Locale: any new string goes in `web/src/locales/en.json` and all locales (test `tests/locale-resources.test.ts`).

## Validation

- `cd web && pnpm lint && pnpm test`
- `go test -v -race ./server/...` (recurrence test)
- Manual: create `- [ ]` item with Ctrl+Shift+Enter, Ctrl+Enter, reload, confirm persisted; mark all done in edit mode and preview; confirm date advances and tasks reset; confirm recurrence label next to date.

## Out of scope

- Changing recurrence model or schedule storage.
- Auth/API proto changes (none expected).

## Open questions

- Confirm decision 1 (unified surface) and 3 (rollover in preview) before implementation.
