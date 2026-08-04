import { createSampleState } from "./sample-data";
import { createAppStore, reduce } from "./store";
import { migrate, saveState } from "./storage";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const timestamp = "2026-08-02T14:00:00.000Z";
let raw = JSON.stringify(createSampleState(timestamp, "test-client"));
const storage = { read: () => raw, write: (value: string) => { raw = value; } };

const app = createAppStore(storage);
const completed = app.dispatch({ type: "task.complete", taskId: "task-welcome" });
assert(completed.ok && completed.state.tasks["task-welcome"].completedAt, "Completion should persist.");

const reopened = createAppStore(storage);
const undone = reopened.dispatch({ type: "undo" });
assert(undone.ok && undone.state.tasks["task-welcome"].completedAt === null, "Undo should survive a reload.");

const base = createSampleState(timestamp, "conflict-client");
const left = reduce(base, { type: "task.add", input: { id: "task-left", content: "Left" } }, timestamp);
const right = reduce(base, { type: "task.add", input: { id: "task-right", content: "Right" } }, timestamp);
assert(left.ok && right.ok, "Conflict setup should reduce cleanly.");
raw = JSON.stringify(base);
assert(saveState(storage, left.state, base.revision).ok, "First writer should save.");
assert(!saveState(storage, right.state, base.revision).ok, "Stale writer must be rejected.");

const migrated = migrate({ ...base, schemaVersion: 1, sections: undefined, filters: undefined, orderItems: undefined });
assert(migrated.schemaVersion === 3 && Object.keys(migrated.sections).length === 0 && Object.keys(migrated.orderItems).length === 0, "Legacy state should migrate.");

const invalidMove = reduce(base, { type: "task.update", taskId: "task-welcome", patch: { sectionId: "missing" } });
assert(!invalidMove.ok, "Cross-project or missing section assignment must be rejected.");

const projectState = createSampleState(timestamp, "project-client");
const projectAdded = reduce(projectState, {
  type: "project.add",
  input: { id: "project-delete-me", name: "Delete me" },
}, timestamp);
assert(projectAdded.ok, "Project deletion setup should add a project.");
const sectionAdded = reduce(projectAdded.state, {
  type: "section.add",
  input: { id: "section-delete-me", projectId: "project-delete-me", name: "Work" },
}, timestamp);
assert(sectionAdded.ok, "Project deletion setup should add a section.");
const taskAdded = reduce(sectionAdded.state, {
  type: "task.add",
  input: { id: "task-delete-me", content: "Keep this task", projectId: "project-delete-me", sectionId: "section-delete-me" },
}, timestamp);
assert(taskAdded.ok, "Project deletion setup should add a task.");
const projectDeleted = reduce(taskAdded.state, { type: "project.delete", projectId: "project-delete-me" }, timestamp);
assert(projectDeleted.ok && !projectDeleted.state.projects["project-delete-me"], "Project should be deleted.");
assert(projectDeleted.state.tasks["task-delete-me"].projectId === projectDeleted.state.preferences.inboxProjectId, "Project tasks should move to Inbox.");
const projectRestored = reduce(projectDeleted.state, projectDeleted.state.undoStack[projectDeleted.state.undoStack.length - 1]?.inverse ?? { type: "undo" }, timestamp);
assert(projectRestored.ok && projectRestored.state.projects["project-delete-me"] && projectRestored.state.tasks["task-delete-me"].projectId === "project-delete-me", "Project undo should restore tasks and project.");

const orderAdded = reduce(base, { type: "order.add", input: { id: "order-test", title: "Sequence this", lane: "after", relationId: "order-welcome" } }, timestamp);
assert(orderAdded.ok && orderAdded.state.orderItems["order-test"].relationId === "order-welcome", "Order relationships should persist.");
assert(!reduce(orderAdded.state, { type: "order.update", itemId: "order-test", patch: { relationId: "order-test" } }, timestamp).ok, "Order items cannot relate to themselves.");

raw = "{bad-json";
const recovered = createAppStore(storage);
const recoveredWrite = recovered.dispatch({ type: "task.add", input: { content: "Recovered task" } });
assert(recoveredWrite.ok, "A recovered state should accept its first durable mutation.");

console.log("CORE_STATE_TESTS_OK");
