# Plan: Memo UX fixes — editing, scheduling, hotkeys, filters

## Context

Follow-up to earlier feed/schedule UI work. After rebuilding the SPA (`pnpm release`) and
redeploying, the user reports a set of interaction and semantics problems. Two are confirmed
root causes in code; the rest are new behavior to add. This plan separates them, names real
functions, and calls out the one server-side change (recurrence-on-completion) explicitly.

Key facts found while investigating:

- Edit-in-place is `MemoInlineEditor` (`web/src/components/MemoView/components/MemoInlineEditor.tsx`),
  opened via `openLeanEditor` → `isLeanEditing`. It has a border + Save button added earlier.
- Single/double click is gated by `doubleClickEdit` in `useDevicePreferences`
  (`web/src/hooks/useDevicePreferences.ts`, default `false`), used in
  `useMemoHandlers` (`web/src/components/MemoView/hooks/useMemoHandlers.ts:28`).
- The schedule toolbar button is only shown for **new** memos:
  `onSchedule={!memoName && !parentMemoName ? handleScheduleDraft : undefined}`
  (`EditSession.tsx:448`). Editing an existing memo never shows it.
- Feed hotkeys: `useMemoListHotkeys` (`web/src/hooks/useMemoListHotkeys.ts`) already binds
  j/k **and** arrows (lines 70-81) and skips typing targets / overlays (line 68).
- `isOverlayOpen()` (line 14) checks `[role=dialog],[role=menu],[data-popup-open]`.
- Editor caret/task hotkeys live in `memoEditorHotkeys` (`edit/hotkeys.ts:182`). `cycleTaskOp`
  already converts a non-list line to a task (lines 84-87).
- "Doing" tasks: literal `- [/]` marker, styled amber only as text via `.mbe-doing-task`
  (`index.css:65`). In preview the marker text shows but there is no checkbox state.
- Filter popover = `MemoFilterPopover`; cheatsheet = `ShortcutsDialog` + the keyboard button
  in `PagedMemoList.tsx:399-408`. Both are controlled by `AppSidebarContext` flags.
- Scheduling: `ScheduleDraft` (`types/components.ts:77`), `TimestampInput`
  (`components/TimestampPopover.tsx:27`), host `handleScheduleDraft` (`EditSession.tsx:337`).

## Decisions (confirmed with user)

1. Arrow keys in edit mode = caret movement only. No code change needed; just ensure feed
   hotkeys never intercept arrows while an editor/typing target is focused (already true).
2. Scheduling becomes a real server-side recurrence: a plan has a next fire; on completion
   the next occurrence is computed and stored; one-off plans stop after their single fire.
3. Templates: ship seed templates (recurring note, recurring todo note) + a recurring memo
   view the feed can default to.

## Work items

### A. Editing surface (frontend only)

1. **Arrow keys** — Verify only. Add a unit test in `tests/` that `useMemoListHotkeys`
   ignores `ArrowUp/Down/Left/Right` when the target is a contenteditable/input. No prod change.
2. **Schedule button in edit mode** — In `EditSession.tsx:448`, pass `onSchedule` for edits
   too, wiring it to an update-schedule path instead of create. Add an `onReschedule` path:
   for an existing memo, find its active plan (by template memo name) and update it; if none
   exists, fall back to create. This requires the schedule list lookup in `EditSession`
   (`useScheduleList`).
3. **Single-click to edit (feature toggle)** — Extend `DevicePreferences`
   (`useDevicePreferences.ts`) with `singleClickEdit: boolean` (default `false`). In
   `useMemoHandlers`, when `singleClickEdit` is on, the single click on the memo body opens
   the editor. Expose the toggle in `MemoDisplaySettingMenu` (or the device-preferences
   settings panel where `linkPreview`/`doubleClickEdit` are surfaced).
4. **Click highlights the card for shortcuts** — The focus ring already renders
   (`PagedMemoList.tsx:391`) but only from `j/k`. Add a click handler on the card wrapper
   that sets `focusedName` for that memo (lift a `setFocused` from `useMemoListHotkeys` or
   add a `focusMemo(name)` return). Ensure shortcuts then apply to the clicked card.
5. **Ctrl/Cmd+S in inline edit saves** — Already wired: `MemoInlineEditor` passes
   `onSave` (flush + done) into `buildEditorExtensions`. Confirm the toolbar-less inline
   editor actually registers `memoEditorHotkeys` (via `buildEditorExtensions`); if not, add
   the extension explicitly. Add a test that Mod+S flushes.
6. **Do not regress the save button / border** — keep the earlier border + Save button.

### B. Scheduling semantics (server + store + UI)

1. **Recurrence-on-completion** — Change schedule lifecycle so a plan stores its recurrence
   rule and current `nextRun`; when a plan's memo is completed/published, compute and persist
   the following `nextRun` (`everyNDays` / `weekdayMask`) instead of a one-shot publish.
   - `server/api/schedule_service.go` + `core/schedule/` (recurrence calc, no SQL).
   - Store: `store/schedule.go` + the three drivers (`store/db/{sqlite,mysql,postgres}/schedule.go`),
     add migration `26.11/03__schedule_recurrence.sql` and update each `LATEST.sql`.
   - Keep one-off plans retiring after their single fire.
2. **Date selector for the start date** — Replace the free-text `TimestampInput` inside
   `ScheduleDraftMenu` with a date picker (a `type="date"` input or the Base UI date picker
   already used elsewhere) plus a time field; keep manual text entry as an alternative tab.
3. **Update `ScheduleDraft`** — No field change needed; the `everyNDays`/`weekdayMask`
   already exist. Add the completion-driven next-run on the server side only.
4. **Reschedule from edit** — Covered by A2; ensure the update path uses
   `useUpdateSchedule` with the correct `updateMask`.

### C. Templates & recurring view (frontend, depends on B)

1. **Seed templates** — Add two templates offered when composing:
   "Recurring note" and "Recurring todo note" (a markdown body with a task list).
   Wire them into the composer's template/suggestion entry so selecting one pre-fills the
   editor body and opens the schedule menu.
2. **Recurring memo view default** — Add a built-in "Recurring" memo view (a saved-filter
   view backed by the plan/schedule data or a `property`/tag convention). Default the Home
   feed's `memoView` to it. This is the piece that needs a data source decision (see Open
   questions) — if a built-in view is too large, expose it as a toggle in view settings that
   filters to memos with an active plan.

### D. Doing-task preview (frontend/CSS)

1. Render `- [/]` as an in-progress checkbox state in the read-only renderer: either map it
   to a checkbox with an "indeterminate"/amber state, or style the marker as a distinct
   checkbox glyph in `.mbe-doing-task`. Keep the amber accent; ensure preview shows the
   state, not just colored text.

### E. Filter & cheatsheet buttons (verify, then fix)

- Confirm `MemoFilterPopover` open state round-trips through `AppSidebarContext`
  (`memoFilterMenuOpen`) and that the trigger's `onOpenChange` fires on click. If the popover
  mounts in the grid path only via `gridLeading`, ensure the button is present in both
  layouts and opens.
- Confirm the `ShortcutsDialog` and the keyboard button both call `openShortcuts(true)` and
  the dialog's `onOpenChange` sets it false. The earlier close-button fix should hold; add a
  test that clicking the trigger toggles the flag.

### F. Restore shortcut hint

- The user liked the hotkey hint text. Restore a concise hint line (not the removed
  `focus-cue` caption): re-add a single muted line near the filter/cheatsheet buttons, e.g.
  "j / k move · / search · ? shortcuts". Reuse/replace `memo.hotkey-hint` and re-translate
  across all locales (locale test enforces full coverage).

## Validation

- `cd web && pnpm lint` (typecheck + Biome) and `pnpm test` (Vitest). Locale additions must
  be added to every locale file or `tests/locale-resources.test.ts` fails.
- `cd proto && buf generate && buf lint` if any proto field changes for schedules.
- `go test ./...` for `core/schedule`, `server/api`, `store` if the server recurrence changes
  land; add a store test for next-occurrence computation.
- Manual: rebuild SPA `cd web && pnpm release`, redeploy `docker compose -f scripts/compose.yaml up -d --build`,
  hard reload, then verify each item in the checklist.

## Risks / notes

- The recurrence-on-completion change is the largest piece: it touches the schedule service,
  all three DB drivers, migrations, and the `LATEST.sql` files. Keep it backward compatible
  (existing publish-at plans keep working until migrated).
- A built-in "recurring" memo view may need a new filter factor or a convention (tag/property).
  If that is too large, ship the seed templates + a view-settings toggle first and defer the
  default view.
- No browser tooling is available in this environment (no Chrome for Playwright), so UI items
  can only be verified by the user after redeploy.

## Open questions

1. For the recurring view data source: use a **tag convention** (e.g. recurring plans carry a
   tag the view filters on), or a **dedicated filter factor** backed by plan data? (Recommend
   the tag convention for a smaller, migration-free change.)
   **Resolved: tag convention.** Recurring plans carry a tag; the default "Recurring" view
   filters on it. No schema change for the view.
2. Should the "complete → advance to next occurrence" be automatic on every save of a
   recurring plan's memo, or only when the user marks the memo/task done?
   **Resolved: on mark-done only.** Advancing happens when the user marks the memo/task done
   (done checkbox / explicit complete), not on every save.