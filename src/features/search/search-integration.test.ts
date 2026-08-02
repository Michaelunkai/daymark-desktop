import { createSampleState } from "../../core/sample-data.ts";
import { createAppStore } from "../../core/store.ts";
import type { StateStorage } from "../../core/types.ts";
import { buildSearchRecords, type SearchMetadataByTaskId } from "./from-app-state.ts";
import { filterSearchRecords } from "./query-parser.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function memoryStorage(): StateStorage {
  let value: string | null = null;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}

function recordsFor(store: ReturnType<typeof createAppStore>, metadata: SearchMetadataByTaskId = {}) {
  return buildSearchRecords(store.getState(), metadata);
}

function matchingTaskIds(records: ReturnType<typeof buildSearchRecords>, query: string): string[] {
  return filterSearchRecords(records, query, "2026-08-02")
    .filter((record) => record.type === "task")
    .map((record) => record.id);
}

const storage = memoryStorage();
const store = createAppStore(storage, () => createSampleState("2026-08-02T09:00:00.000Z", "search-test"));
assert(store.dispatch({
  type: "project.add",
  input: { id: "project-work", name: "Work", description: "Client delivery" },
}).ok, "Project creation should succeed.");
assert(store.dispatch({
  type: "section.add",
  input: { id: "section-launch", projectId: "project-work", name: "Launch" },
}).ok, "Section creation should succeed.");
assert(store.dispatch({
  type: "label.add",
  input: { id: "label-client", name: "Client", color: "blue" },
}).ok, "Label creation should succeed.");
assert(store.dispatch({
  type: "task.add",
  input: {
    id: "task-searchable",
    content: "Prepare launch brief",
    description: "Initial scope",
    projectId: "project-work",
    sectionId: "section-launch",
    labelIds: ["label-client"],
    priority: 2,
    due: { date: "2026-08-03", time: null, timezone: null, recurrence: null },
  },
}).ok, "Task creation should succeed.");

assert(matchingTaskIds(recordsFor(store), "brief").includes("task-searchable"), "Created tasks should be searchable immediately.");
assert(store.dispatch({
  type: "task.update",
  taskId: "task-searchable",
  patch: { content: "Publish launch brief", description: "Final scope", priority: 1 },
}).ok, "Task editing should succeed.");
assert(matchingTaskIds(recordsFor(store), "publish priority:1").includes("task-searchable"), "Edited content and priority should refresh immediately.");
assert(store.dispatch({
  type: "task.update",
  taskId: "task-searchable",
  patch: { projectId: "project-inbox", sectionId: null, due: { date: "2026-08-02", time: null, timezone: null, recurrence: "every week" } },
}).ok, "Project and date move should succeed.");
assert(matchingTaskIds(recordsFor(store), "project:inbox due:today recurring:true").includes("task-searchable"), "Moves, due dates, and recurrence should refresh immediately.");
assert(store.dispatch({ type: "task.complete", taskId: "task-searchable" }).ok, "Completion should succeed.");
assert(matchingTaskIds(recordsFor(store), "completed:true").includes("task-searchable"), "Completion should refresh immediately.");
assert(store.dispatch({ type: "task.uncomplete", taskId: "task-searchable" }).ok, "Reopening should succeed.");
assert(store.dispatch({
  type: "task.update",
  taskId: "task-searchable",
  patch: { labelIds: ["label-client"] },
}).ok, "Label update should succeed.");
assert(matchingTaskIds(recordsFor(store), "label:client").includes("task-searchable"), "Label changes should refresh immediately.");
assert(
  matchingTaskIds(recordsFor(store, {
    "task-searchable": { assignee: "Jordan", comments: ["Stakeholder approved the revised brief."] },
  }), "assigned:jordan comment:stakeholder").includes("task-searchable"),
  "External assignment and comment metadata should be searchable on refresh.",
);
const syncedStore = createAppStore(storage);
assert(syncedStore.dispatch({
  type: "task.update",
  taskId: "task-searchable",
  patch: { content: "Synced launch brief" },
}).ok, "A remote sync mutation should succeed.");
store.reload();
assert(
  matchingTaskIds(recordsFor(store), "synced").includes("task-searchable"),
  "A rebuild after a sync reload should use the latest task state.",
);

console.log("SEARCH_INTEGRATION_TESTS_OK");
