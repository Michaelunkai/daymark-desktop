# Daymark Organizer Acceptance Matrix

This matrix is the reliability contract for the integrated local-first organizer.
Feature owners can mark the UI rows complete only after exercising the real
workflow in a fresh browser process with the current shared store.

## Shared Data Contract

| Contract | Acceptance rule | Evidence in this checkout |
| --- | --- | --- |
| Schema | `AppState.schemaVersion` is `3`; schema `0`, `1`, and `2` migrate without dropping valid tasks. | `src/core/store.test.ts`: migration assertion passes. |
| Shared collections | `tasks`, calendar task due metadata, `notes`, and `diaryEntries` live in one persisted `AppState`. | `src/core/types.ts`, `src/core/sample-data.ts`, `src/core/storage.ts`. |
| Note links | Notes may link to known tasks and an optional known project; unknown links are rejected on writes and pruned during migration. | `note.add`/`note.update` store paths and cross-feature test. |
| Diary links | Diary entries require a valid local date and may link to known tasks; unknown links are rejected on writes and pruned during migration. | `diary.add`/`diary.update` store paths and cross-feature test. |
| Task deletion | Deleting a task removes its note/diary links; the task deletion inverse retains those links for undo-capable callers. | `task.delete` path and cross-feature test. |
| Calendar association | Moving a task changes only its due date and preserves time, timezone, recurrence, project, section, labels, and text. | Existing calendar movement tests plus store task-update validation. |
| Reload | A new store instance reads the last valid state and retains edits, associations, completion, and undo state. | Existing reload/undo test plus export/import round trip. |
| Malformed storage | Invalid JSON or unsupported/incomplete state returns a usable fallback and calls optional `StateStorage.backup` with the raw payload. | Malformed-storage test passes. |
| Blocked storage | `localStorage` exceptions do not crash the session; writes continue in memory and expose `getStorageStatus() === "memory"`. | Blocked-storage test passes. |
| Conflicts | A stale revision is rejected and the latest valid saved state is surfaced to the caller. | Existing stale-writer test passes. |
| Portability | `exportState` emits current-schema JSON; `importState` migrates and validates it and rejects malformed input. | Export/import assertions pass. |
| Offline/local-first | No sign-in, network request, or remote persistence is required for core state operations. | Store/storage tests use injected local storage only. |

## Product Acceptance

| Area | Scenario | Pass evidence required | Status |
| --- | --- | --- | --- |
| First run | Open with no state, create one task, one note, and one diary entry. | All records render; one persisted state key is created; no sign-in prompt. | Core verified; UI pending feature integration. |
| Reload | Reload after task completion, calendar movement, note edit, and diary edit. | All changes and links are present after a fresh app/store instance. | Core verified; UI pending feature integration. |
| Recovery | Start with malformed JSON, then create a new record. | App remains usable; recovery backup is retained; first valid mutation replaces the bad primary state. | Core verified. |
| Blocked storage | Deny `getItem` and `setItem`. | App remains usable for the session and reports memory-only persistence without claiming durability. | Core verified. |
| Calendar planning | Create scheduled and unscheduled tasks in week, month, and year views; navigate ranges; reopen after reload. | Dates, counts, task metadata, and selected range remain correct. | Pending live UI verification. |
| Task movement | Move a task by pointer and keyboard across day/week/month/year boundaries. | Valid moves persist; stale or invalid payloads do not mutate the task. | Core movement tests verified; pending live UI verification. |
| Task completion | Complete and uncomplete a scheduled task from list and calendar surfaces. | Completion state persists and calendar associations remain unchanged. | Pending live UI verification. |
| Note editing | Create, edit, reload, and delete a note linked to a task/project. | Content, links, and updated timestamps persist; task deletion removes the link. | Core contract verified; pending note UI. |
| Note search | Search by note title and body from the organizer search surface. | Matching note appears without false task-only results. | Pending note/search integration. |
| Diary writing | Write an entry for a valid local date, edit it, and reopen it. | Date, title, body, and task links persist across reload. | Core contract verified; pending diary UI. |
| Diary browse | Browse entries by date and return to an earlier entry. | Entry ordering and date identity are stable after reload. | Pending diary UI. |
| Diary search | Search by diary title and body. | Matching entries appear without losing task/calendar results. | Pending diary/search integration. |
| Keyboard navigation | Use the documented shortcuts and keyboard-only focus order across shell, calendar, task editor, note editor, and diary editor. | No keyboard trap; visible focus; Escape/Enter behavior is deterministic. | Existing shell partially verified by feature tests; full organizer pending. |
| Responsive layout | Exercise desktop, tablet, and narrow mobile widths while editing and browsing each feature. | No clipped text, overlapping controls, or inaccessible dialogs. | Pending live UI verification. |
| Offline/local-first | Disable network after initial load and repeat create/edit/search/reload. | Core workflows continue without sign-in or network failures. | Core verified; live browser proof pending. |

## Integration Checklist

- Shared feature code should import `AppState`, `UserAction`, and entity types from `src/core`.
- Feature code should dispatch through the single `AppStore`; it should not write its own `localStorage` key.
- Notes use `linkedTaskIds` and `linkedProjectId`; diary entries use `date` and `linkedTaskIds`.
- Calendar/task code must preserve the complete `TaskDue` object when changing only a date.
- UI code should surface `getStorageStatus()` as a non-blocking durability state, not as a sign-in requirement.
- Import flows should call `importState` before dispatching or replacing app state; never accept raw JSON directly.
- A feature may add view-local state, but user data must be represented in the shared schema before it is considered persisted.
