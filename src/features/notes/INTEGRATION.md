# Notes and Diary Integration Contract

The notes domain is intentionally isolated from the shared shell, navigation, task reducers, and calendar reducers.

## Mounting

Import `NotesWorkspace` and its stylesheet through `src/features/notes/index.ts`:

```tsx
<NotesWorkspace
  notes={Object.values(state.notes)}
  diaryEntries={Object.values(state.diaryEntries)}
  projects={Object.values(state.projects).map(({ id, name }) => ({ id, name }))}
  defaultNotesProjectId={state.preferences.activeProjectId}
  onDispatch={appStore.dispatch}
/>
```

The host owns routing and navigation. Use `initialMode="diary"` when opening the journal route directly.

## Capture and triage behavior

- Notes are split into two feature-level destinations without changing the shared state shape:
  - `linkedProjectId === null` is the Inbox, optimized for fast capture and later triage.
  - a non-null `linkedProjectId` is an organized Note associated with that project.
- Inbox items sort by `createdAt` first, so the newest thought is immediately visible even after edits.
- The Inbox composer focuses the body field and accepts `Ctrl+Enter` or `Cmd+Enter` to save without leaving capture.
- Moving an Inbox thought to Notes is an existing `note.update` with `linkedProjectId`; the project selector is required before save.
- Diary remains a separate date-addressed destination. Diary entries use their existing local `date` and `createdAt` fields.
- The component does not write to storage directly and does not require shell or reducer changes.

## State contract

- `state.notes` is a `Record<string, Note>`.
- `state.diaryEntries` is a `Record<string, DiaryEntry>`.
- Route all `NotesAction` values to `appStore.dispatch`.
- The component does not write to storage directly. `createAppStore` persists every successful mutation through the existing revision-checked browser storage.
- `Note` supports `title`, multiline `content`, `tags`, `isPinned`, and `isArchived`.
- `DiaryEntry` supports local `date`, `title`, multiline `content`, `mood`, `tags`, and `isFavorite`.

## Privacy and recovery

Writing data stays in the existing localStorage-backed state. No network or remote sync is required by this feature. Schema migration adds empty collections to older state, and malformed individual note/diary records are discarded while valid task/project state is preserved.

## Search and date behavior

- Notes search title, body, and tags.
- Diary search title, body, tags, date, and mood.
- Diary browsing uses `YYYY-MM-DD` local dates and groups the index by the selected date.
- `searchWriting`, `sortNotes`, `sortDiaryEntries`, and `getDiaryDates` are exported for hosts that need a shared index or command-palette integration.
