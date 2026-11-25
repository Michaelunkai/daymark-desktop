import assert from "node:assert/strict";
import test from "node:test";

import { createTaskEditorDraft } from "./form-state";
import { taskEditorDraftToTaskInput, taskToTaskEditorDraft } from "./adapters";

test("persists a validated reminder from the task editor", () => {
  const result = taskEditorDraftToTaskInput(
    createTaskEditorDraft({
      title: "Call the clinic",
      reminderText: "in 15 minutes",
    }),
    {
      today: "2026-09-09",
      now: new Date("2026-09-09T00:00:00.000Z"),
      inboxProjectId: "project-inbox",
    },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.reminderAt, "2026-09-09T00:15:00.000Z");
  }
});

test("rejects unsupported reminder text and restores a stored reminder for editing", () => {
  const invalid = taskEditorDraftToTaskInput(
    createTaskEditorDraft({ title: "Call the clinic", reminderText: "when the moon is full" }),
    { now: new Date("2026-09-09T00:00:00.000Z") },
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(Boolean(invalid.errors.reminderText), true);

  const draft = taskToTaskEditorDraft({
    id: "task-clinic",
    content: "Call the clinic",
    description: "",
    projectId: "project-inbox",
    sectionId: null,
    parentId: null,
    priority: 4,
    due: null,
    reminderAt: "2026-09-09T00:15:00.000Z",
    reminderState: "pending",
    completedAt: null,
    completionContext: null,
    order: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(draft.reminderText.length > 0, true);
});
