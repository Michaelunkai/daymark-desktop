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
assert(migrated.schemaVersion === 3 && Object.keys(migrated.sections).length === 0, "Legacy state should migrate.");

const invalidMove = reduce(base, { type: "task.update", taskId: "task-welcome", patch: { sectionId: "missing" } });
assert(!invalidMove.ok, "Cross-project or missing section assignment must be rejected.");

const noteAdded = reduce(base, {
  type: "note.add",
  input: { id: "note-test", title: "  Ideas  ", content: "  Keep this nearby.  ", tags: ["work", "work"] },
}, timestamp);
assert(noteAdded.ok, "Notes should be creatable.");
assert(noteAdded.state.notes["note-test"].title === "Ideas", "Note titles should be trimmed.");
assert(noteAdded.state.notes["note-test"].tags.join(",") === "work", "Note tags should be normalized.");

const noteUpdated = noteAdded.ok
  ? reduce(noteAdded.state, { type: "note.update", noteId: "note-test", patch: { isPinned: true } }, timestamp)
  : noteAdded;
assert(noteUpdated.ok && noteUpdated.state.notes["note-test"].isPinned, "Notes should be editable.");

const noteDeleted = noteUpdated.ok
  ? reduce(noteUpdated.state, { type: "note.delete", noteId: "note-test" }, timestamp)
  : noteUpdated;
assert(noteDeleted.ok && !noteDeleted.state.notes["note-test"], "Notes should be deletable.");

const diaryAdded = reduce(base, {
  type: "diary.add",
  input: { id: "diary-test", date: "2026-08-03", title: "Today", content: "A useful day.", mood: "good" },
}, timestamp);
assert(diaryAdded.ok && diaryAdded.state.diaryEntries["diary-test"].mood === "good", "Diary entries should persist metadata.");
const invalidDiary = reduce(base, {
  type: "diary.add",
  input: { id: "diary-invalid", date: "2026-02-30", content: "No." },
}, timestamp);
assert(!invalidDiary.ok, "Invalid diary dates must be rejected.");

const legacyWithNoWriting = migrate({ ...base, schemaVersion: 2, notes: undefined, diaryEntries: undefined });
assert(legacyWithNoWriting.schemaVersion === 3 && Object.keys(legacyWithNoWriting.notes).length === 0, "Schema v2 should gain empty writing collections.");

const malformedWriting = migrate({
  ...base,
  notes: { broken: { id: "broken", title: "Missing timestamps" } },
  diaryEntries: { broken: { id: "broken", date: "not-a-date", title: "", content: "" } },
});
assert(Object.keys(malformedWriting.notes).length === 0 && Object.keys(malformedWriting.diaryEntries).length === 0, "Malformed writing records should be discarded safely.");

raw = "{bad-json";
const recovered = createAppStore(storage);
const recoveredWrite = recovered.dispatch({ type: "task.add", input: { content: "Recovered task" } });
assert(recoveredWrite.ok, "A recovered state should accept its first durable mutation.");

console.log("CORE_STATE_TESTS_OK");
