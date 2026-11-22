# Plan: Simple memo recurrence (no schedule table, no sweep)

## Goal
Setting a date/recurrence on a memo only modifies that memo. Nothing is published later; no cron, no sweep, no separate `schedule` entity.

## Current behaviour (verified)
- Confirm button in `ScheduleDraftMenu.tsx` (label `schedule.create`, shown as "Create plan") calls `onConfirm` → `EditSession.tsx:337 handleScheduleDraft`.
- `handleScheduleDraft` calls `createSchedule.mutate` (`hooks/useScheduleQueries.ts:27`) and on success runs `dispatch(actions.reset())` (`EditSession.tsx:353`). This clears the composer, which is why the memo "disappears" in the screenshot.
- The popover closes via `setOpen(false)` in `ScheduleDraftMenu.confirm`, but the reset wipes the editor first.
- Recurrence already exists on the memo as `MemoPayload.Recurrence`; `rollRecurringMemo` (`server/api/memo_service_recurrence.go`) rolls tasks and `CreatedTs` forward in `UpdateMemo` (`memo_service.go:395-405`).

## Desired behaviour (agreed)
1. Clicking the confirm button sets the memo's create date (`create_time`) to the chosen date/time and stores the recurrence on the memo.
2. The popover closes.
3. The editor stays open in edit mode with the content intact. No reset, no new memo, no toast-only flow.
4. The user saves normally with the existing Save button; the date/recurrence are applied then (or applied immediately to the draft's memo if it already exists, see open question).
5. Rename the button from "Create plan" to a label such as "Set date" (copy to confirm).

## Ordered tasks
1. **Frontend confirm flow** (`EditSession.tsx`, `ScheduleDraftMenu.tsx`):
   - Replace `handleScheduleDraft` so it writes `createTime` and `recurrence` into the composer state (dispatch a field update), not into `createSchedule`.
   - Remove the `actions.reset()` call and the `createSchedule` mutation.
   - Keep the popover closing via `setOpen(false)`; keep editor state untouched.
2. **Composer state**: add `recurrence` and `createTime` fields to the edit-session reducer so they are submitted with the memo on Save.
3. **Server create/update**: accept `recurrence` on `Memo` (proto field) and apply `create_time` on save (existing `create_time` update path, `memo_service.go:416`).
4. **Remove schedule code**: delete `ScheduleService` proto, `schedule_service*.go`, `core/schedule` schedule-only parts, `store/schedule.go`, the three driver `schedule.go` files, `startScheduleSweeper` and `RunScheduleSweep` in `server/server.go`, `UpcomingSchedules.tsx`, `useScheduleQueries.ts`. Add migrations dropping `schedule` for sqlite/mysql/postgres; update each `LATEST.sql`.
5. **Locales**: rename `schedule.create`; drop unused `schedule.*` keys from all locales (`tests/locale-resources.test.ts` enforces parity).
6. **Rollover**: keep `rollRecurringMemo` as the only recurrence advance; confirm it reads the recurrence stamped by step 3.

## Edge cases to resolve
- Memo not yet saved (new composer): date/recurrence are stored in the draft and applied on the first Save. Memo already saved (edit mode): applied on Save, same path.
- Empty content: keep the existing guard (`schedule.empty-content` → rename to a generic key).
- Future `create_time`: check feed sorting/visibility for future-dated memos.
- Recurrence with no tasks never rolls; confirm this is acceptable.
- Weekday math uses UTC on the server; the local-to-UTC conversion must happen in the frontend.

## Validation
- `go test -v -race ./server/... ./core/... ./store/...` plus new tests: create/update with recurrence and create_time; rollover on save.
- `cd proto && buf lint && buf generate`; confirm only expected generated diffs.
- `cd web && pnpm lint && pnpm test && pnpm build`.
- Manual: open composer, set date/recurrence, confirm popover closes and the editor keeps its text; Save; check the memo date; tick all tasks, save, confirm the date rolls and tasks uncheck.

## Open questions
1. Should confirming the popover in edit mode save the memo immediately, or only stage the values until the user clicks Save? (Recommended: stage until Save, matching "remain in edit mode until I'm done".)
2. Final button label text (recommended: "Set date").
3. Has the schedule feature shipped? If not, drop the table without a data migration.
