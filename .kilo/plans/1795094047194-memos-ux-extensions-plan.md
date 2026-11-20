# Memos UX Extensions — Implementation Plan

Goal: add memo drag-sorting, a filter popover, global/list/editor hotkeys with contextual cues, scheduled & recurring memos, autosaved fast inline editing, stable list positions while editing, and one-click date changes — without breaking existing memos or existing memo data.

## Context (verified in code)

- Feed: `web/src/components/PagedMemoList/PagedMemoList.tsx` — infinite scroll (`useInfiniteMemos`), server order `pinned desc, create_time|update_time asc|desc` (`web/src/hooks/useMemoSorting.ts:37-67`, `server/api/memo_service_query.go:11-67`). No order storage anywhere.
- Filters: flat factor list in `web/src/contexts/MemoFilterContext.tsx` synced to `?filter=`; chips in `MemoFilters.tsx`; CEL built in `web/src/hooks/useMemoFilters.ts`; Quick Find (`QuickFindDialog.tsx`) for search/cel. No faceted filter UI, no order support inside CEL (by design).
- Editor: one markdown binding `web/src/components/MemoEditor/MemoMarkdown.tsx` (rich = view = edit); existing memos already edit in place (`MemoView/MemoBody.tsx:63-78` → `MemoEditor mode="edit"`); draft cache + flush-on-unmount exists but is disabled for edits (`edit/EditSession.tsx:115-116`, `edit/hooks/useAutoSave.ts:59-90`). Save = `Meta/Control+Enter`.
- Markdown engine: goldmark `extension.TaskList` (`markdown/markdown.go:103`), `KindTaskCheckBox` → `has_task_list`/`has_incomplete_tasks` (`:258-264`), renderer round-trips `[x]`/`[ ]` (`markdown/renderer/markdown_renderer.go:160-165`).
- Background jobs: `server/server.go:164-178` (`startBackgroundJobs`), ticker precedent `server/api/upload_session.go:106-121`.
- Reuse asset: `web/src/components/MemoMetadata/Attachment/useDragReorder.ts` — dependency-free pointer+keyboard reorder hook with FLIP animations and Escape cancel.
- Memo table columns: `store/migration/{sqlite,mysql,postgres}/LATEST.sql`; update mask rejects unknown paths (`server/api/memo_service.go:417`).

## Decisions (user-confirmed)

1. **Recurring**: template-clone semantics — a schedule definition (Markdown template + recurrence) spawns a fresh, independent, normal memo at each fire.
2. **Recurrence complexity**: `every N days` + `weekly on selected weekdays` (+ one-off fixed date). No rrule library.
3. **Visibility**: "Upcoming" section (sidebar) + Calendar badges on future days.
4. **Drag sort**: persisted per-creator manual order via a new fractional `order_no` column; "Manual" is one alternative sort option; drag only in own-feed contexts.
5. **Hotkeys**: accepted scheme — `Ctrl+Enter` cycles task line; save moves to `Ctrl/⌘+S`; list hotkeys + `?` cheat sheet.
6. **Doing marker**: `- [/]` (Obsidian-compatible), rendered amber, counts as incomplete.

## Assumptions (not blocking)

- "Preview editable" = clicking into a memo body (or `e` on a focused card) turns the rendered view directly editable in place, autosaving to the server debounced (~800 ms) — no mode switch, no Save button for existing memos. The full composer (with toolbar and explicit Save) remains for new memos and comments.
- "Don't reshuffle on editing" = while an edit session is active the memo keeps its list position regardless of `update_time` bumps; filters/day changes flush the pending edit so nothing is lost (this is the autosave trigger).
- Scheduler runs server-side only for legitimate owners; all new endpoints require auth. No hotkey customization UI (defaults only) — out of scope.
- Hotkey cues = `?` cheat-sheet overlay + hint bar under the focused memo + `aria-keyshortcuts` on buttons; no toast spam.

---

## Phase 0 — Spike (do first, 1 commit max scope)

1. Verify `- [/]` support path: install `web` deps, inspect `@usememos/editor@26.11.6` (`llms.txt`/dist) for task-marker options beyond `[x]`/`[ ]`.
   - If supported: configure at `web/src/components/MemoEditor/MemoMarkdown.tsx` (options seam).
   - If not: implement `- [/]` purely at the memos layer — memo decorations (`useMemoDecorations.ts`) style/label unknown-marker task lines amber with an "in progress" state, and `markdown-task-actions.ts` splices markers. Do not fork the block editor in this repo; record the gap in the plan PR description.

## Phase 1 — Fast inline editing + autosave + stable position + date popover

2. Add "lean/inline" edit mode to `MemoView`: body renders the same `MemoMarkdown` binding with `editable` + memo extensions, no composer chrome; owner-only, entered by single-click into body (caret at click) or `e` hotkey; `Escape` blurs; toolbar/suggestions stay available via slash menu.
3. Debounced server autosave for inline edits: reuse `useUpdateMemo` queue; debounce ~800 ms, immediate flush on unmount, filter change, day change, or `Ctrl/⌘+S`. Update mask `["content","update_time"]`; keep `create_time` untouched.
4. Draft cache for edits: stop gating on `!memo` (`EditSession.tsx` `isDraftCacheEnabled`), cache under `edit:<name>` (draftKey.ts scheme), flush via existing `useAutoSave` unmount path, restore on re-edit, discard on save/discard. Belt-and-suspenders alongside server autosave.
5. Position freeze while editing: in `useMemoSorting`/`PagedMemoList` client `listSort`, keep the memo at its current index while an edit session is active (context flag from MemoView), including through query patches; when sorted by `update_time`, the move happens only after the session ends. Add a test.
6. One-click date change: memo header date (owner) becomes a button opening a date-time popover (Base UI `Popover` + existing `DateTimeInput` pattern, mirroring editor `TimestampPopover.tsx:71-95`) → `updateMemo({ create_time }, ["create_time"])`. Headers elsewhere reuse the same popover component. Tests for update mask and popover open/close.

## Phase 2 — Task-state machine + editor line hotkeys (markdown-based)

7. Markdown engine (Go): replace stock `extension.TaskList` (`markdown/markdown.go:103`) with a memos-owned task-checkbox parser extension recognizing `[x]`, `[X]`, `[ ]`, `[/]` (precedent: custom parsers in `markdown/parser/`). Round-trip render `[/]` (`markdown_renderer.go:160-165`). `ExtractProperties` treats `[/]` as a task and as incomplete (`has_incomplete_tasks` stays correct, memo_service.proto untouched).
8. Web cycling util: extend `web/src/utils/markdown-task-actions.ts` with a pure `cycleTaskLine(markdown, lineIndex)` transform: `- [ ]` → `- [/]` → `- [x]` → plain `- ` → `- [ ]`. Unit tests (incl. nested list indentation, code fences untouched).
9. Wire `Ctrl+Enter` in editor (`EditSession`/`Editor.tsx` keymap): when caret is on or inside a list line that matches `TASK_LINE_REGEXP`, call the cycle util through the controller (`getMarkdown` → transform → `setMarkdown` with caret restore); otherwise no-op (do not swallow). Unit tests at the util level.
10. Move line up/down: pure util `moveLineUpDown(markdown, lineIndex, delta)` swapping adjacent logical lines/blocks (respect multi-line list items via the existing AST `lineTable` from `@usememos/editor`), wired to `Alt+↑/↓` through the controller with caret restore. Unit tests.
11. Key binding move: memo save becomes `Ctrl/⌘+S` (composer + inline edit + comment editor); remove `Control+Enter` from save (`edit/types/components.ts:58`, `Toolbar/EditorToolbar.tsx:77-84`); keep `Meta+Enter`? No — both move to Ctrl/⌘+S to free Ctrl+Enter. `aria-keyshortcuts` updated. Update editor README.

## Phase 3 — Manual drag order (persisted)

12. DB: new nullable column `order_no REAL` (DOUBLE in MySQL, DOUBLE PRECISION in Postgres) on `memo` in all three drivers: new migration folder under `store/migration/<driver>/` (next unreleased version dir, e.g. `26.11/01__add_memo_order.sql`) + `LATEST.sql` updates. Fresh-install SQL ≡ incremental. No index initially (small user feeds); note a future `(creator_id, row_status, order_no)` index.
13. Store layer: `store/memo.go` — `Memo.OrderValue *float64`? (goose naming: `OrderValue`), `UpdateMemo.OrderValue *float64` nullable; drivers apply `order_no` (sqlite `store/db/sqlite/memo_attachment.go:191-230`, mysql, postgres mirrors).
14. API: `proto/api/memo_service.proto` — add `optional double order = 9` to `Memo` (additive), doc "Ignored on creation; set via update_mask to record manual drag order"; add `order` to update mask paths (`:392-395`) and to `order_by` doc whitelist. `server/api/memo_service.go` — mask path `order` → set `OrderValue` (supports clearing: update with value 0 keeps order_no default? define: use a `clear_order` semantic only if needed — simple v1: order always settable, not clearable). Run `cd proto && buf generate && buf lint && buf format -w`; no breaking fields, no CHANGELOG entry needed.
15. Order support server-side: `parseMemoOrderBy` (`memo_service_query.go`) accepts `order` (asc, or `order asc`); SQL ordering: `pinned DESC, order_no ASC NULLS LAST, <time basis> DESC, id DESC` — exact dialect forms: SQLite `ORDER BY pinned DESC, order_no IS NULL, order_no, ...`; MySQL `order_no IS NULL, order_no`; Postgres `order_no ASC NULLS LAST`. All three drivers + tie-break `id DESC`.
16. Frontend: `useMemoSorting` — new `manualOrder` option persisted in ViewContext `memos-view-setting`; builds `order_by=order asc, <timeBasis>` (pinnedFirst kept), and client-side listSort mirrors it. `MemoDisplaySettingMenu` gains "Manual (drag)" choice.
17. Drag: adapt `useDragReorder` to the single-column memo flow (`PagedMemoList`): drag handle on memo header (owner only, when `manualOrder` active... plan: drag auto-switches view to Manual on first drag with a toast), drop writes fractional `order_no` between neighbors via `updateMemo({order}, ["order"])` using optimistic queue; arrow-key reorder already in the hook. Disable drag in packed `ColumnGrid` mode (tooltip explains) and on Explore/other-creator feeds. Keyboard reordering via the same hook already covered.
18. Tests: driver SQL ordering tests (+ MariaDB variant via `DRIVER=mysql MYSQL_VARIANT=mariadb`), fractional insert between neighbors, drag in feed test, mixed pinned-first behavior.

## Phase 4 — Filter popover + list hotkeys + cues

19. Filters popover: in `PagedMemoList` header next to search — Base UI `Menu`/`Popover` with facets: date range (from/to pickers), pinned, has task[^] / link / code / attachments / image / location, visibility, tags; writes existing/new `MemoFilter` factors through `MemoFilterContext` (URL `?filter=` persistence free); `buildMemoFilter` renders range via `created_ts/updated_ts` bounds (extend `useMemoFilters.ts`; new `dateRange` factor type). Supplier chips continue rendering in `MemoFilters.tsx`. Hotkey `f` opens it; `/` keeps Quick Find.
20. Hotkey layer: create `web/src/hooks/useMemoListHotkeys.ts` (window-level, disabled while typing in inputs/editor/dialogs — check `document.activeElement` editable state and Base UI open state):
    - `↑/↓`: roving focus across flattened memo list (`getMemoKey` order), scroll-into-view (contextual: filter+search active count shown in a hint bar), `Home/End` jump, `esc` clears focus.
    - `enter`/`o` open focused memo (existing detail navigation), `e` inline edit, `p` pin, `d` archive with existing confirm dialog, `x`? (not now), `?` opens cheat sheet.
21. Cues: focused memo gets `mu-focus` ring + a contextual hint row (small, `mu-caption`) showing its available keys; `?` overlay (Base UI dialog) lists grouped shortcuts; `aria-keyshortcuts` added to the relevant buttons. Shortcut cheat-sheet test; hotkey unit tests with a key-event harness.
22. Arrow navigation also scrolls page naturally when at list bottom (successive ArrowDown triggers existing fetchMore). Do not hotkey-steal when a menu/dialog/editor is open.

## Phase 5 — Scheduled & recurring memos

23. Store: new sibling table `schedule` (not on `memo`): `id, uid, creator_id, space_id NULL, row_status NORMAL|ARCHIVED, content TEXT (template), visibility, every_n_days INT NULL, weekdays INT NULL (bitmask Mon..Sun), fire_at_ts BIGINT NULL (one-off), next_run_ts BIGINT, last_fired_ts, last_created_memo_uid, created_ts, updated_ts`. Migrations + `LATEST.sql` ×3. Store struct + methods in `store/schedule.go` (or sibling naming per repo layout). FK ON DELETE CASCADE with memo drop policy NOT needed (independent rows; user deletion cascades).
24. Core: `core/schedule/schedule.go` — pure `nextRunAfter(schedule, ts)` (every N days; weekly by bitmap; nulls = one-off `fire_at_ts`), used by scheduler and by UI validation. Unit-tested exhaustively (DST-less epoch math, weekly wrap, catch-up policy: fire only missed ≤ 1 due at a time; skip stale beyond 7 days? define: fire missed occurrences up to `max(1, now - 7 days)` then set next_run = now).
25. Service layer: `server/api/schedule_service.go` (+ converters file per repo convention) — proto `proto/api/schedule_service.proto`: `Schedule { name: users/{u}/schedules/{uid}, content, visibility, space, recurrence fields, next_run_ts, last_created_memo, create_time, update_time, state }`, RPCs: `CreateSchedule`, `GetSchedule`, `ListSchedules` (filter by upcoming/active), `UpdateSchedule` (update_mask), `DeleteSchedule`. Register in `server/api/acl_config.go` — authenticated-only (default), no anonymous entries. `buf generate` (Go + TS + OpenAPI), additive-only so no CHANGELOG entry.
26. Scheduler: in `server/server.go` `startBackgroundJobs`, add a ticker goroutine (1-minute tick, ctx-aware): fetch due schedules (`next_run_ts <= now`, active), for each create a normal memo from the template (`memoService`-level call path used by create RPC helpers incl. `RefreshMemoDerivedPayload`, `create_time` = due ts so it lands in the right calendar day), update `next_run_ts`/`last_fired_ts`, and `publishMemoChanged()` over SSE so open UIs refresh. One-off: after firing set `row_status = ARCHIVED` (retained for reference). Concurrency-safe: single goroutine; small transaction per fire.
27. UI: composer gains a "Schedule" affordance (popover with date-time + every-N-days / weekday pickers, none = one-off). Upcoming section in sidebar (list of next firings with edit/delete + toggle pause via `state`); Calendar: fetch upcoming schedules and render dots/badges on future days (reuse `useMonthMemos` fetch or schedule list fetch, day-model integration minimal). Everything via new TS proto clients (`connect.ts`).
28. Recurring clones make changes to memo payload naturally (tags etc. from template content processed by the same markdown pipeline).

## Phase 6 — Polish, docs, locales

29. i18n: all new `web/src/locales/en.json` keys translated in every locale (locale-resources test enforces); no plural additions needed unless introduced.
30. Docs: update `web/src/components/MemoEditor/README.md` (lean edit, Ctrl/⌘+S, Ctrl+Enter cycle, Alt+↑↓), `web/src/components/MemoView` docs if present, AGENTS.md "Change Routing" only if a new top surface was added (likely none — feature lands in existing packages).

## Validation

- Go: `go test -v -race ./server/... ./core/... ./markdown/... ./internal/...`; store drivers via `go test -v ./store/...`; MariaDB `DRIVER=mysql MYSQL_VARIANT=mariadb go test -v ./store/test/...`.
- Lint: `golangci-lint run`; `go mod tidy -go=1.27.4`; `go fix -diff ./...`.
- Proto: `cd proto && buf generate && buf lint && buf format -w` and diff cleanup.
- Web: `cd web && pnpm lint && pnpm test && pnpm build` (build guards the go:embed SPA).
- Behavior checks: fresh install vs migrated instance produce identical memo ordering defaults; archived/Explore flows unchanged; autosave flush on filter/day change; no position jump during edit; drag persists and reloads.

## Risks & mitigations

- **`@usememos/editor` may not support `- [/]`** → Phase 0 spike; fallback = memo-layer decorations + marker splicing (no fork of the editor package in this repo).
- **goldmark TaskCheckBox parser semantics** for `[/]` → implement memos-owned parser; verify parser round-trip tests in `markdown/markdown_test.go`.
- **Fractional order clustering** after many insertions between two memos → renormalize lazily when gap < ε (reassign sequence across the user's memos) — implement opportunistically, low priority.
- **`order_no` + pinned interplay** → pinned stays `DESC` first; drag within pinned region unaffected by time sorting.
- **Scheduler duplicate firing on restarts** → fire transactions keyed by `next_run_ts` so re-read after restart skips already-fired dedupe (check `last_fired_ts` before create).
- **Hotkeys vs dialogs/editors** → guarded activation; cheat sheet documents guard.

## Out of scope

- Hotkey customization UI / per-user shortcut settings.
- Notion-style databases, one-off tables, custom recurrence via rrule.
- Editing schedule definitions from cloned memos.
- Declared clear-order semantics (unclearing a memo's manual order).
- Reordering other users' memos, drag in packed grid mode, drag on Explore.
