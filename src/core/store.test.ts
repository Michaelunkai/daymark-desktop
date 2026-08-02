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

const migrated = migrate({ ...base, schemaVersion: 1, sections: undefined, filters: undefined });
assert(migrated.schemaVersion === 2 && Object.keys(migrated.sections).length === 0, "Legacy state should migrate.");

const invalidMove = reduce(base, { type: "task.update", taskId: "task-welcome", patch: { sectionId: "missing" } });
assert(!invalidMove.ok, "Cross-project or missing section assignment must be rejected.");

const workflowBase = createSampleState(timestamp, "workflow-client");
const projectAdded = reduce(workflowBase, {
  type: "project.add",
  input: { id: "project-work", name: "Work" },
}, timestamp);
assert(projectAdded.ok, "Projects should be created.");
const sectionAdded = reduce(projectAdded.state, {
  type: "section.add",
  input: { id: "section-work", projectId: "project-work", name: "Planning" },
}, timestamp);
assert(sectionAdded.ok, "Sections should be created.");
const parentAdded = reduce(sectionAdded.state, {
  type: "task.add",
  input: { id: "task-parent", content: "Plan launch", projectId: "project-work", sectionId: "section-work" },
}, timestamp);
assert(parentAdded.ok, "Parent tasks should be created.");
const childAdded = reduce(parentAdded.state, {
  type: "task.add",
  input: {
    id: "task-child",
    content: "Write brief",
    projectId: "project-work",
    sectionId: "section-work",
    parentId: "task-parent",
  },
}, timestamp);
assert(childAdded.ok, "Subtasks should be created in their parent location.");
const invalidChild = reduce(childAdded.state, {
  type: "task.update",
  taskId: "task-child",
  patch: { parentId: "task-child" },
}, timestamp);
assert(!invalidChild.ok, "A task cannot be its own parent.");
const taskDeleted = reduce(childAdded.state, { type: "task.delete", taskId: "task-parent" }, timestamp);
assert(taskDeleted.ok && !taskDeleted.state.tasks["task-parent"] && !taskDeleted.state.tasks["task-child"], "Deleting a task should cascade to subtasks.");
const taskRestored = taskDeleted.ok ? reduce(taskDeleted.state, { type: "undo" }, timestamp) : taskDeleted;
assert(taskRestored.ok && taskRestored.state.tasks["task-parent"] && taskRestored.state.tasks["task-child"], "Undo should restore a deleted task tree.");

const copied = reduce(childAdded.state, { type: "task.duplicate", taskId: "task-parent" }, timestamp);
assert(copied.ok, "Task trees should duplicate.");
const copiedRoot = Object.values(copied.state.tasks).find((task) => task.content === "Plan launch (copy)");
assert(copiedRoot, "Duplicated task root should be named.");
assert(
  Object.values(copied.state.tasks).some((task) => task.parentId === copiedRoot.id && task.content === "Write brief"),
  "Duplicating a task should duplicate its subtasks.",
);

const bulkCompleted = reduce(childAdded.state, {
  type: "task.bulk.complete",
  taskIds: ["task-parent", "task-child", "task-child"],
}, timestamp);
assert(
  bulkCompleted.ok && bulkCompleted.state.tasks["task-parent"].completedAt && bulkCompleted.state.tasks["task-child"].completedAt,
  "Bulk completion should normalize a selection and update every task.",
);
const bulkRescheduled = reduce(bulkCompleted.state, {
  type: "task.bulk.reschedule",
  taskIds: ["task-parent", "task-child"],
  due: { date: "2026-08-10", time: null, timezone: null, recurrence: null },
}, timestamp);
assert(
  bulkRescheduled.ok && bulkRescheduled.state.tasks["task-child"].due?.date === "2026-08-10",
  "Bulk rescheduling should preserve a full due-date payload.",
);
const bulkMoved = reduce(bulkRescheduled.state, {
  type: "task.bulk.move",
  taskIds: ["task-parent"],
  location: { projectId: "project-personal", sectionId: "section-next" },
}, timestamp);
assert(
  bulkMoved.ok &&
    bulkMoved.state.tasks["task-parent"].projectId === "project-personal" &&
    bulkMoved.state.tasks["task-child"].sectionId === "section-next",
  "Moving a parent task should move its subtask tree.",
);

const sectionDeleted = reduce(childAdded.state, { type: "section.delete", sectionId: "section-work" }, timestamp);
assert(
  sectionDeleted.ok && !sectionDeleted.state.sections["section-work"] && sectionDeleted.state.tasks["task-parent"].sectionId === null,
  "Deleting a section should preserve its tasks in the project.",
);
const sectionRestored = sectionDeleted.ok ? reduce(sectionDeleted.state, { type: "undo" }, timestamp) : sectionDeleted;
assert(
  sectionRestored.ok && sectionRestored.state.sections["section-work"] && sectionRestored.state.tasks["task-parent"].sectionId === "section-work",
  "Undo should restore a section and its task membership.",
);

const childProject = reduce(childAdded.state, {
  type: "project.add",
  input: { id: "project-work-child", name: "Work child", parentId: "project-work" },
}, timestamp);
assert(childProject.ok, "Nested projects should be created.");
const projectRenamed = childProject.ok
  ? reduce(childProject.state, { type: "project.update", projectId: "project-work", patch: { name: "Client work" } }, timestamp)
  : childProject;
assert(projectRenamed.ok && projectRenamed.state.projects["project-work"].name === "Client work", "Projects should update.");
const invalidProjectCycle = childProject.ok
  ? reduce(childProject.state, { type: "project.update", projectId: "project-work", patch: { parentId: "project-work-child" } }, timestamp)
  : childProject;
assert(!invalidProjectCycle.ok, "Project trees must reject cycles.");
const sectionRenamed = reduce(childAdded.state, {
  type: "section.update",
  sectionId: "section-work",
  patch: { name: "Execution", isCollapsed: true },
}, timestamp);
assert(
  sectionRenamed.ok && sectionRenamed.state.sections["section-work"].name === "Execution" && sectionRenamed.state.sections["section-work"].isCollapsed,
  "Sections should update.",
);
const archived = childProject.ok
  ? reduce(childProject.state, { type: "project.archive", projectId: "project-work", archived: true }, timestamp)
  : childProject;
assert(
  archived.ok && archived.state.projects["project-work"].isArchived && archived.state.projects["project-work-child"].isArchived,
  "Archiving a project should archive its descendants.",
);
const archiveUndone = archived.ok ? reduce(archived.state, { type: "undo" }, timestamp) : archived;
assert(
  archiveUndone.ok && !archiveUndone.state.projects["project-work"].isArchived && !archiveUndone.state.projects["project-work-child"].isArchived,
  "Undo should restore project archive state.",
);
const invalidInboxDelete = reduce(childAdded.state, { type: "project.delete", projectId: "project-inbox" }, timestamp);
assert(!invalidInboxDelete.ok, "The Inbox project must be protected.");
const projectDeleted = childProject.ok
  ? reduce(childProject.state, { type: "project.delete", projectId: "project-work" }, timestamp)
  : childProject;
assert(
  projectDeleted.ok &&
    !projectDeleted.state.projects["project-work"] &&
    !projectDeleted.state.projects["project-work-child"] &&
    !projectDeleted.state.sections["section-work"] &&
    !projectDeleted.state.tasks["task-parent"],
  "Deleting a project should cascade through children, sections, and tasks.",
);
const projectRestored = projectDeleted.ok ? reduce(projectDeleted.state, { type: "undo" }, timestamp) : projectDeleted;
assert(
  projectRestored.ok && projectRestored.state.projects["project-work"] && projectRestored.state.tasks["task-child"],
  "Undo should restore a deleted project tree intact.",
);

raw = "{bad-json";
const recovered = createAppStore(storage);
const recoveredWrite = recovered.dispatch({ type: "task.add", input: { content: "Recovered task" } });
assert(recoveredWrite.ok, "A recovered state should accept its first durable mutation.");

console.log("CORE_STATE_TESTS_OK");
