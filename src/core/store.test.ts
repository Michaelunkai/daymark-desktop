import { createSampleState } from "./sample-data";
import { createAppStore, reduce, rollOverIncompleteTasks } from "./store";
import { loadState, migrate, saveState } from "./storage";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const timestamp = "2026-08-02T14:00:00.000Z";
let raw = JSON.stringify(createSampleState(timestamp, "test-client"));
const storage = { read: () => raw, write: (value: string) => { raw = value; } };

const app = createAppStore(storage);
const completed = app.dispatch({ type: "task.complete", taskId: "task-welcome" });
assert(completed.ok && completed.state.tasks["task-welcome"].completedAt, "Completion should persist.");
const completedAt = completed.ok ? completed.state.tasks["task-welcome"].completedAt : null;
assert(
  completed.ok &&
    completed.state.tasks["task-welcome"].completionContext?.sectionId === "section-next",
  "Completion should preserve the original active context.",
);
const repeatedCompletion = app.dispatch({ type: "task.complete", taskId: "task-welcome" });
assert(
  repeatedCompletion.ok &&
    repeatedCompletion.state.tasks["task-welcome"].completedAt === completedAt,
  "Repeated completion should be idempotent and retain its original timestamp.",
);

const reopened = createAppStore(storage);
const undone = reopened.dispatch({ type: "undo" });
assert(undone.ok && undone.state.tasks["task-welcome"].completedAt === null, "Undo should survive a reload.");

const restoreState = createSampleState(timestamp, "restore-client");
const restoredStorage = {
  read: () => JSON.stringify(restoreState),
  write: (value: string) => Object.assign(restoreState, JSON.parse(value)),
};
const restoreApp = createAppStore(restoredStorage);
const completedRestore = restoreApp.dispatch({ type: "task.complete", taskId: "task-welcome" });
assert(completedRestore.ok, "Task should complete before restore.");
const restored = restoreApp.dispatch({ type: "task.uncomplete", taskId: "task-welcome" });
assert(
  restored.ok &&
    restored.state.tasks["task-welcome"].completedAt === null &&
    restored.state.tasks["task-welcome"].projectId === "project-personal" &&
    restored.state.tasks["task-welcome"].sectionId === "section-next" &&
    restored.state.tasks["task-welcome"].order === 0,
  "Restore should return a task to its original active context.",
);
const repeatedRestore = restoreApp.dispatch({ type: "task.uncomplete", taskId: "task-welcome" });
assert(
  repeatedRestore.ok && repeatedRestore.state.tasks["task-welcome"].completedAt === null,
  "Repeated restore should be idempotent.",
);

const rolloverSource = createSampleState(timestamp, "rollover-client");
rolloverSource.tasks["task-welcome"].due = {
  date: "2026-08-11",
  time: "09:30",
  timezone: "Asia/Jerusalem",
  recurrence: "every day",
};
rolloverSource.tasks["task-welcome"].completedAt = null;
rolloverSource.tasks["task-completed"] = {
  ...rolloverSource.tasks["task-welcome"],
  id: "task-completed",
  due: {
    ...rolloverSource.tasks["task-welcome"].due,
    date: "2026-08-11",
  },
  completedAt: "2026-08-11T12:00:00.000Z",
};
rolloverSource.tasks["task-unscheduled"] = {
  ...rolloverSource.tasks["task-welcome"],
  id: "task-unscheduled",
  due: null,
};
const rolledOver = rollOverIncompleteTasks(
  rolloverSource,
  "2026-08-12",
  "2026-08-12T00:00:00.000Z",
);
assert(
  rolledOver.changed &&
    rolledOver.state.tasks["task-welcome"].due?.date === "2026-08-12" &&
    rolledOver.state.tasks["task-welcome"].due?.time === "09:30" &&
    rolledOver.state.tasks["task-welcome"].due?.recurrence === "every day" &&
    rolledOver.state.tasks["task-completed"].due?.date === "2026-08-11" &&
    rolledOver.state.tasks["task-unscheduled"].due === null,
  "Opening Daymark should carry overdue incomplete tasks into today without changing completed or unscheduled tasks.",
);

const base = createSampleState(timestamp, "conflict-client");
const left = reduce(base, { type: "task.add", input: { id: "task-left", content: "Left" } }, timestamp);
const right = reduce(base, { type: "task.add", input: { id: "task-right", content: "Right" } }, timestamp);
assert(left.ok && right.ok, "Conflict setup should reduce cleanly.");
raw = JSON.stringify(base);
assert(saveState(storage, left.state, base.revision).ok, "First writer should save.");
assert(!saveState(storage, right.state, base.revision).ok, "Stale writer must be rejected.");

const migrated = migrate({ ...base, schemaVersion: 1, sections: undefined, filters: undefined, orderItems: undefined });
assert(
  migrated.schemaVersion === 5 &&
    Object.keys(migrated.sections).length === 0 &&
    Object.keys(migrated.notes).length === 0 &&
    Object.keys(migrated.diaryEntries).length === 0 &&
    migrated.tasks["task-welcome"].completionContext === null &&
    !("labels" in migrated) &&
    !("labelIds" in migrated.tasks["task-welcome"]),
  "Legacy state should migrate to schema v5 without tags.",
);

const legacyCompleted = migrate({
  ...base,
  schemaVersion: 2,
  tasks: {
    ...base.tasks,
    "task-welcome": {
      ...base.tasks["task-welcome"],
      completedAt: "2026-08-03T12:34:56.000Z",
    },
  },
});
assert(
  legacyCompleted.tasks["task-welcome"].completionContext?.order === 0,
  "Schema v2 completed tasks should gain an active-context snapshot.",
);
const migratedDoneOrder = migrate({
  ...base,
  orderItems: {
    "order-done-legacy": {
      ...base.orderItems["order-welcome"],
      id: "order-done-legacy",
      status: "done",
      updatedAt: timestamp,
    },
  },
});
assert(
  !migratedDoneOrder.orderItems["order-done-legacy"] &&
    migratedDoneOrder.tasks["completed-order-order-done-legacy"]?.completedAt === timestamp,
  "Stored done Order items should migrate into Completed.",
);
const migratedDoneOrderCollision = migrate({
  ...base,
  tasks: {
    ...base.tasks,
    "completed-order-order-done-legacy": {
      ...base.tasks["task-welcome"],
      id: "completed-order-order-done-legacy",
      content: "Existing task",
    },
  },
  orderItems: {
    "order-done-legacy": {
      ...base.orderItems["order-welcome"],
      id: "order-done-legacy",
      status: "done",
      updatedAt: timestamp,
    },
  },
});
assert(
  migratedDoneOrderCollision.tasks["completed-order-order-done-legacy-2"]?.completedAt === timestamp,
  "Stored done Order items should retain their history if a migration task ID is already taken.",
);

const longText = "x".repeat(100_000);
const large = reduce(
  base,
  {
    type: "task.add",
    input: {
      id: "task-large",
      content: longText,
      description: longText,
    },
  },
  timestamp,
);
assert(
  large.ok &&
    large.state.tasks["task-large"].content.length === longText.length &&
    large.state.tasks["task-large"].description.length === longText.length,
  "Large task content and descriptions must persist without arbitrary limits.",
);

const longNote = reduce(
  base,
  {
    type: "note.add",
    input: { id: "note-large", title: longText, body: longText },
  },
  timestamp,
);
assert(
  longNote.ok &&
    longNote.state.notes["note-large"].title.length === longText.length &&
    longNote.state.notes["note-large"].body.length === longText.length,
  "Large note content must persist without arbitrary limits.",
);

const longDiary = reduce(base, { type: "diary.upsert", date: "2026-08-04", body: longText }, timestamp);
assert(
  longDiary.ok && longDiary.state.diaryEntries["2026-08-04"].body.length === longText.length,
  "Large diary content must persist without arbitrary limits.",
);

const longProject = reduce(
  base,
  { type: "project.add", input: { id: "project-large", name: longText, description: longText } },
  timestamp,
);
assert(
  longProject.ok &&
    longProject.state.projects["project-large"].name.length === longText.length &&
    longProject.state.projects["project-large"].description.length === longText.length,
  "Large project content must persist without arbitrary limits.",
);

const longOrder = reduce(
  base,
  { type: "order.add", input: { id: "order-large", title: longText, details: longText } },
  timestamp,
);
assert(
  longOrder.ok &&
    longOrder.state.orderItems["order-large"].title.length === longText.length &&
    longOrder.state.orderItems["order-large"].details.length === longText.length,
  "Large Order content must persist without arbitrary limits.",
);

let journalRaw = JSON.stringify(createSampleState(timestamp, "journal-client"));
const journalStorage = { read: () => journalRaw, write: (value: string) => { journalRaw = value; } };
const journalApp = createAppStore(journalStorage);
assert(journalApp.dispatch({ type: "note.add", input: { id: "note-reload", title: "Reload me", body: "Durable note" } }).ok, "Note should save.");
assert(journalApp.dispatch({ type: "diary.upsert", date: "2026-08-04", body: "Durable diary" }).ok, "Diary should save.");
const journalReload = createAppStore(journalStorage).getState();
assert(journalReload.notes["note-reload"].body === "Durable note", "Notes should survive reload.");
assert(journalReload.diaryEntries["2026-08-04"].body === "Durable diary", "Diary should survive reload.");

const ordered = createSampleState(timestamp, "order-client");
ordered.tasks["task-second"] = {
  ...ordered.tasks["task-welcome"],
  id: "task-second",
  content: "Second",
  order: 1,
};
const reordered = reduce(
  ordered,
  { type: "task.reorder", input: { taskId: "task-second", sectionId: "section-next", order: 0 } },
  timestamp,
);
assert(
  reordered.ok &&
    reordered.state.tasks["task-second"].order === 0 &&
    reordered.state.tasks["task-welcome"].order === 1,
  "Task reorder should durably preserve sibling ordering.",
);
const projectReorderStorage = {
  raw: JSON.stringify(ordered),
  read() {
    return this.raw;
  },
  write(value: string) {
    this.raw = value;
  },
};
const projectReorderApp = createAppStore(projectReorderStorage);
const projectReorderAdded = projectReorderApp.dispatch({
  type: "project.add",
  input: { id: "project-third", name: "Third project", order: 2 },
});
assert(projectReorderAdded.ok, "Project reorder setup should add a project.");
const projectMove = projectReorderApp.dispatch({
  type: "project.update",
  projectId: "project-third",
  patch: { order: 0 },
});
assert(projectMove.ok, "Project reorder should persist its order mutation.");
const projectReorderReload = createAppStore(projectReorderStorage).getState();
assert(
  projectReorderReload.projects["project-third"].order === 0 &&
    projectReorderReload.projects["project-personal"].order === 1,
  "Project ordering should survive a store reload.",
);
assert(Object.keys(migrated.orderItems).length === 0, "Legacy state should migrate with an empty Order collection.");

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
const completedOrder = reduce(base, { type: "order.complete", itemId: "order-welcome" }, timestamp);
assert(
  completedOrder.ok &&
    !completedOrder.state.orderItems["order-welcome"] &&
    Object.values(completedOrder.state.tasks).some(
      (task) =>
        task.content === "Choose the next useful step" &&
        task.description === "Keep this list small enough to act on." &&
        task.completedAt === timestamp,
    ),
  "Completing an Order item should immediately move its task details into Completed.",
);
const legacyDeleteCompletesOrder = reduce(base, { type: "order.delete", itemId: "order-welcome" }, timestamp);
assert(
  legacyDeleteCompletesOrder.ok &&
    !legacyDeleteCompletesOrder.state.orderItems["order-welcome"] &&
    Object.values(legacyDeleteCompletesOrder.state.tasks).some((task) => task.content === "Choose the next useful step" && task.completedAt === timestamp),
  "Removing an Order item should preserve it as a completed task.",
);
const statusDoneCompletesOrder = reduce(
  base,
  { type: "order.update", itemId: "order-welcome", patch: { status: "done" } },
  timestamp,
);
assert(
  statusDoneCompletesOrder.ok &&
    !statusDoneCompletesOrder.state.orderItems["order-welcome"] &&
    Object.values(statusDoneCompletesOrder.state.tasks).some((task) => (
      task.content === "Choose the next useful step" &&
      task.completedAt === timestamp
    )),
  "Marking an Order item done should immediately move it to Completed.",
);
const createdDoneOrder = reduce(
  base,
  { type: "order.add", input: { id: "order-created-done", title: "Done on arrival", status: "done" } },
  timestamp,
);
assert(
  createdDoneOrder.ok &&
    !createdDoneOrder.state.orderItems["order-created-done"] &&
    Object.values(createdDoneOrder.state.tasks).some((task) => (
      task.content === "Done on arrival" &&
      task.completedAt === timestamp
    )),
  "Creating an Order item as done should immediately place it in Completed.",
);

raw = "{bad-json";
const recovered = createAppStore(storage);
const recoveredWrite = recovered.dispatch({ type: "task.add", input: { content: "Recovered task" } });
assert(recoveredWrite.ok, "A recovered state should accept its first durable mutation.");

const malformedImport = loadState({ read: () => "{bad-json", write: () => undefined });
assert(malformedImport.recovered, "Malformed imports must be reported as recovered failures.");

const blockedStorage = {
  read: () => { throw new Error("storage blocked"); },
  write: () => { throw new Error("storage blocked"); },
};
const blockedApp = createAppStore(blockedStorage);
const blockedFirst = blockedApp.dispatch({ type: "task.add", input: { id: "blocked-one", content: "Keep in memory" } });
const blockedSecond = blockedApp.dispatch({ type: "task.add", input: { id: "blocked-two", content: "Keep this too" } });
assert(
  blockedFirst.ok &&
    blockedSecond.ok &&
    blockedSecond.state.tasks["blocked-one"] &&
    blockedSecond.state.tasks["blocked-two"],
  "Storage failures must preserve the live in-memory workspace across mutations.",
);
const resetBlocked = blockedApp.reset();
assert(
  !resetBlocked.tasks["blocked-one"] && resetBlocked.tasks["task-welcome"],
  "Reset should clear the live workspace even when storage is unavailable.",
);

const taskToOrder = reduce(
  base,
  {
    type: "task.transferToOrder",
    taskId: "task-welcome",
    input: {
      title: "Welcome in Order",
      details: "Keep the task context.",
      lane: "later",
      priority: 2,
    },
  },
  timestamp,
);
assert(
  taskToOrder.ok &&
    !taskToOrder.state.tasks["task-welcome"] &&
    Object.values(taskToOrder.state.orderItems).some(
      (item) =>
        item.title === "Welcome in Order" &&
        item.lane === "later" &&
        item.priority === 2,
    ),
  "Moving a task to Order should remove the task and create the requested Order item.",
);
const taskToOrderUndone = taskToOrder.ok
  ? reduce(taskToOrder.state, { type: "undo" }, timestamp)
  : taskToOrder;
assert(
  taskToOrderUndone.ok &&
    taskToOrderUndone.state.tasks["task-welcome"] &&
    !Object.values(taskToOrderUndone.state.orderItems).some(
      (item) => item.title === "Welcome in Order",
    ),
  "Undo should restore a task moved into Order without leaving the converted item behind.",
);

const taskCopiedToOrder = reduce(
  base,
  {
    type: "order.add",
    input: {
      id: "order-copy",
      title: base.tasks["task-welcome"].content,
      details: base.tasks["task-welcome"].description,
      lane: "after",
      relationId: "order-welcome",
      priority: base.tasks["task-welcome"].priority,
    },
  },
  timestamp,
);
assert(
  taskCopiedToOrder.ok &&
    taskCopiedToOrder.state.tasks["task-welcome"] &&
    taskCopiedToOrder.state.orderItems["order-copy"]?.relationId === "order-welcome",
  "Copying a task to Order should retain the source task and create the requested Order item.",
);

const orderToTask = reduce(
  base,
  {
    type: "order.transferToTask",
    itemId: "order-welcome",
    input: {
      content: "Order item as task",
      description: "Converted from the sequence.",
      projectId: "project-personal",
      sectionId: "section-next",
      due: {
        date: "2026-08-12",
        time: null,
        timezone: null,
        recurrence: null,
      },
    },
  },
  timestamp,
);
assert(
  orderToTask.ok &&
    !orderToTask.state.orderItems["order-welcome"] &&
    Object.values(orderToTask.state.tasks).some(
      (task) =>
        task.content === "Order item as task" &&
        task.projectId === "project-personal" &&
        task.sectionId === "section-next" &&
        task.due?.date === "2026-08-12",
    ),
  "Moving an Order item to tasks should preserve the selected project and day.",
);

const orderCopiedToDate = reduce(
  base,
  {
    type: "task.add",
    input: {
      id: "task-order-date-copy",
      content: "Order item calendar copy",
      description: "Copied from the sequence.",
      projectId: null,
      sectionId: null,
      due: {
        date: "2026-08-20",
        time: null,
        timezone: null,
        recurrence: null,
      },
    },
  },
  timestamp,
);
assert(
  orderCopiedToDate.ok &&
    orderCopiedToDate.state.orderItems["order-welcome"] &&
    orderCopiedToDate.state.tasks["task-order-date-copy"]?.projectId ===
      base.preferences.inboxProjectId &&
    orderCopiedToDate.state.tasks["task-order-date-copy"]?.sectionId === null &&
    orderCopiedToDate.state.tasks["task-order-date-copy"]?.due?.date === "2026-08-20",
  "Copying an Order item to a calendar date should retain the item and create the dated Inbox task.",
);

const orderToTaskUndone = orderToTask.ok
  ? reduce(orderToTask.state, { type: "undo" }, timestamp)
  : orderToTask;
assert(
  orderToTaskUndone.ok &&
    orderToTaskUndone.state.orderItems["order-welcome"] &&
    !Object.values(orderToTaskUndone.state.tasks).some(
      (task) => task.content === "Order item as task",
    ),
  "Undo should restore an Order item moved into tasks without leaving the converted task behind.",
);

console.log("CORE_STATE_TESTS_OK");
