# Task Editor Integration

This feature is a controlled editor surface. It owns draft presentation and
pure form/adapter helpers; the W01 shell owns opening, routing, persistence,
and focus restoration.

## W01 callback wiring

- `isOpen`: set from the shell's Add task action, task-row open action, or
  command-palette Add task action. Keep this state outside the editor.
- `draft`: for an existing core task, create it with
  `taskToTaskEditorDraft(task)`. For a new task, use
  `createTaskEditorDraft({ projectId: activeProjectId })`.
- `onDraftChange(nextDraft, change)`: update the shell's local draft only.
  Do not dispatch a storage mutation for every keystroke.
- `onSave(draft)`: call `taskEditorDraftToTaskInput` for creation or
  `taskEditorDraftToTaskPatch` for editing. On `{ ok: true }`, dispatch the
  coordinator-owned `task.add` or `task.update` action. On `{ ok: false }`,
  keep the editor open and pass the returned `errors` as
  `validationErrors`. Use `saveError` for a non-field persistence failure.
- `onCancel`: discard the local draft and any unsaved validation state.
- `onClose`: remove the overlay/panel and restore focus to the Add task
  control or the task row that opened it. The editor already restores focus to
  the prior active element after unmount.
- `onRequestProjectPicker`: wire to the project-management surface when the
  shell needs a richer picker than the native project select.
- `onRequestLabelPicker`: wire to the label-management surface when the
  shell needs creation/search beyond the provided label options.
- `onRequestReminderPicker`: wire to the reminder scheduler. Reminder
  delivery remains outside this feature.

Pass `toTaskEditorProjectOptions`, `toTaskEditorSectionOptions`, and
`toTaskEditorLabelOptions` the relevant core entities. Sections should be
filtered by the active project before they reach the editor.

## Keyboard and layout

W01 should keep `Ctrl+N`/`Cmd+N` ownership in the shell and open the editor
without firing while a text field is active. The editor owns Escape, Tab
containment, and `Ctrl+Enter`/`Cmd+Enter` save. Use `presentation="panel"` for
the desktop right-side detail surface and `presentation="dialog"` when the
shell needs a centered modal treatment.

No callback in this feature writes storage, changes routes, or launches
browser/OS notification behavior.
