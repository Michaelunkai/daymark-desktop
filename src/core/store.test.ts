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

raw = "{bad-json";
const recovered = createAppStore(storage);
const recoveredWrite = recovered.dispatch({ type: "task.add", input: { content: "Recovered task" } });
assert(recoveredWrite.ok, "A recovered state should accept its first durable mutation.");

console.log("CORE_STATE_TESTS_OK");
