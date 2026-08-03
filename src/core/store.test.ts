import { createSampleState } from "./sample-data";
import { createAppStore, reduce } from "./store";
import {
  createBrowserStorage,
  exportState,
  getBrowserStorage,
  importState,
  loadState,
  migrate,
  RECOVERY_KEY_SUFFIX,
  saveState,
  STORAGE_KEY,
} from "./storage";

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

const migrated = migrate({
  ...base,
  schemaVersion: 1,
  sections: undefined,
  filters: undefined,
  notes: undefined,
  diaryEntries: undefined,
});
assert(
  migrated.schemaVersion === 3 &&
    Object.keys(migrated.sections).length === 0 &&
    Object.keys(migrated.notes).length === 0 &&
    Object.keys(migrated.diaryEntries).length === 0,
  "Legacy state should migrate all shared organizer collections.",
);

const invalidMove = reduce(base, { type: "task.update", taskId: "task-welcome", patch: { sectionId: "missing" } });
assert(!invalidMove.ok, "Cross-project or missing section assignment must be rejected.");
const invalidDue = reduce(base, {
  type: "task.add",
  input: { content: "Invalid schedule", due: { date: "2026-02-30", time: null, timezone: null, recurrence: null } },
});
assert(!invalidDue.ok, "Invalid task dates must be rejected before they reach persistence.");

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

const integrated = createAppStore({
  read: () => raw,
  write: (value: string) => { raw = value; },
});
const addedNote = integrated.dispatch({
  type: "note.add",
  input: {
    id: "note-release",
    title: "Release notes",
    content: "Keep the launch checklist together.",
    linkedTaskIds: ["task-welcome"],
    linkedProjectId: "project-personal",
  },
});
assert(addedNote.ok, "Notes should persist through the shared store.");
const addedDiaryEntry = integrated.dispatch({
  type: "diary.add",
  input: {
    id: "diary-today",
    date: "2026-08-02",
    title: "A focused day",
    content: "Finished the first planning pass.",
    linkedTaskIds: ["task-welcome"],
  },
});
assert(addedDiaryEntry.ok, "Diary entries should persist through the shared store.");
const linkedState = integrated.getState();
assert(linkedState.notes["note-release"].linkedTaskIds[0] === "task-welcome", "Note/task associations should survive.");
assert(linkedState.diaryEntries["diary-today"].linkedTaskIds[0] === "task-welcome", "Diary/task associations should survive.");
const deletedLinkedTask = integrated.dispatch({ type: "task.delete", taskId: "task-welcome" });
assert(deletedLinkedTask.ok, "Deleting a linked task should succeed.");
assert(integrated.getState().notes["note-release"].linkedTaskIds.length === 0, "Deleting a task should scrub note links.");
assert(integrated.getState().diaryEntries["diary-today"].linkedTaskIds.length === 0, "Deleting a task should scrub diary links.");

const recoveryBackups: string[] = [];
const malformedStorage = {
  read: () => "{malformed",
  write: (_value: string) => {},
  backup: (value: string) => recoveryBackups.push(value),
};
const malformedLoad = loadState(malformedStorage, () => createSampleState(timestamp, "recovery-client"));
assert(malformedLoad.recovered, "Malformed storage should report recovery.");
assert(recoveryBackups[0] === "{malformed", "Malformed storage should be preserved for recovery.");

const blockedStorage = createBrowserStorage({
  getItem: () => { throw new Error("Storage blocked"); },
  setItem: () => { throw new Error("Storage blocked"); },
  removeItem: () => { throw new Error("Storage blocked"); },
});
const blockedApp = createAppStore(blockedStorage, () => createSampleState(timestamp, "blocked-client"));
const blockedWrite = blockedApp.dispatch({ type: "task.add", input: { content: "Session-only task" } });
assert(blockedWrite.ok, "Blocked storage should keep the organizer usable in memory.");
assert(blockedApp.getStorageStatus() === "memory", "Blocked storage should be observable as session-only.");

const originalWindow = (globalThis as { window?: unknown }).window;
try {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get localStorage() {
        throw new Error("Storage access blocked");
      },
    },
  });
  assert(getBrowserStorage() === undefined, "Blocked localStorage access should fall back without throwing.");
  assert(createBrowserStorage().getStatus() === "memory", "Default browser storage should support memory-only mode.");
} finally {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
}

const portable = exportState(integrated.getState());
const imported = importState(portable);
assert(imported.schemaVersion === 3, "Exported state should import through the current migration.");
assert(imported.notes["note-release"], "Export/import should preserve notes.");
assert(imported.diaryEntries["diary-today"], "Export/import should preserve diary entries.");
let importRejected = false;
try {
  importState("{not-json");
} catch {
  importRejected = true;
}
assert(importRejected, "Import should reject malformed state instead of silently accepting it.");

const resilienceOriginalWindow = (globalThis as unknown as { window?: unknown }).window;
try {
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, "localStorage", {
    configurable: true,
    get: () => {
      throw new Error("Storage access denied");
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: blockedWindow });
  const guardedDefaultStorage = createBrowserStorage();
  assert(guardedDefaultStorage.getStatus?.() === "memory", "A throwing localStorage getter must fall back to memory.");
} finally {
  if (resilienceOriginalWindow === undefined) delete (globalThis as unknown as { window?: unknown }).window;
  else Object.defineProperty(globalThis, "window", { configurable: true, value: resilienceOriginalWindow });
}

const persistentValues = new Map<string, string>();
let storageBlocked = true;
const recoveringStorage = createBrowserStorage({
  getItem: (key) => {
    if (storageBlocked) throw new Error("Storage blocked");
    return persistentValues.get(key) ?? null;
  },
  setItem: (key, value) => {
    if (storageBlocked) throw new Error("Storage blocked");
    persistentValues.set(key, value);
  },
  removeItem: (key) => {
    if (storageBlocked) throw new Error("Storage blocked");
    persistentValues.delete(key);
  },
});
const recoveringApp = createAppStore(
  recoveringStorage,
  () => createSampleState(timestamp, "recovering-client"),
);
const sessionOnlyWrite = recoveringApp.dispatch({
  type: "task.add",
  input: { id: "task-session-only", content: "Keep this while storage is blocked" },
});
assert(sessionOnlyWrite.ok && recoveringApp.getStorageStatus() === "memory", "Blocked writes must remain usable in memory.");
storageBlocked = false;
const recoveredDurableWrite = recoveringApp.dispatch({
  type: "task.add",
  input: { id: "task-after-recovery", content: "Persist after storage recovers" },
});
assert(recoveredDurableWrite.ok, "A recovered storage adapter should accept the next mutation.");
const recoveredPersisted = persistentValues.get(STORAGE_KEY);
assert(recoveredPersisted, "Recovered memory state should be flushed to durable storage.");
const recoveredState = migrate(JSON.parse(recoveredPersisted));
assert(
  recoveredState.tasks["task-session-only"] && recoveredState.tasks["task-after-recovery"],
  "Storage recovery must not discard session-only edits.",
);
assert(recoveringApp.getStorageStatus() === "persistent", "Successful storage recovery should restore persistent status.");

const malformedPersistentValues = new Map<string, string>([[STORAGE_KEY, "{still-malformed"]]);
let malformedStorageBlocked = false;
const recoverableMalformedStorage = createBrowserStorage({
  getItem: (key) => {
    if (malformedStorageBlocked) throw new Error("Storage blocked");
    return malformedPersistentValues.get(key) ?? null;
  },
  setItem: (key, value) => {
    if (malformedStorageBlocked) throw new Error("Storage blocked");
    malformedPersistentValues.set(key, value);
  },
  removeItem: (key) => {
    if (malformedStorageBlocked) throw new Error("Storage blocked");
    malformedPersistentValues.delete(key);
  },
});
const malformedRecoveryApp = createAppStore(
  recoverableMalformedStorage,
  () => createSampleState(timestamp, "malformed-recovery-client"),
);
assert(
  malformedPersistentValues.get(`${STORAGE_KEY}${RECOVERY_KEY_SUFFIX}`) === "{still-malformed",
  "Malformed state should be preserved in a recovery backup during initial load.",
);
malformedStorageBlocked = true;
const malformedRecoveryWrite = malformedRecoveryApp.dispatch({
  type: "task.add",
  input: { id: "task-malformed-recovery", content: "Replace malformed state" },
});
assert(malformedRecoveryWrite.ok, "Malformed state must remain writable while storage is blocked.");
malformedStorageBlocked = false;
const malformedRecoveryFlush = malformedRecoveryApp.dispatch({
  type: "task.add",
  input: { id: "task-malformed-recovery-2", content: "Keep recovered state" },
});
assert(malformedRecoveryFlush.ok, "Malformed recovery state should flush after storage returns.");
assert(
  malformedPersistentValues.get(`${STORAGE_KEY}${RECOVERY_KEY_SUFFIX}`) === "{still-malformed",
  "The malformed primary payload must remain available as a recovery backup.",
);
const repairedMalformedState = migrate(JSON.parse(malformedPersistentValues.get(STORAGE_KEY)!));
assert(
  repairedMalformedState.tasks["task-malformed-recovery"] &&
    repairedMalformedState.tasks["task-malformed-recovery-2"],
  "The first valid mutation must replace malformed primary storage.",
);

const memoryOnlyStorage = createBrowserStorage(null);
const memoryOnlyApp = createAppStore(memoryOnlyStorage, () => createSampleState(timestamp, "offline-client"));
const memoryOnlyWrite = memoryOnlyApp.dispatch({
  type: "task.add",
  input: { id: "task-offline", content: "Offline task" },
});
assert(memoryOnlyWrite.ok && memoryOnlyApp.getStorageStatus() === "memory", "Offline memory storage must remain usable.");
memoryOnlyApp.reload();
assert(memoryOnlyApp.getState().tasks["task-offline"], "Reloading within the offline session must retain memory state.");

const customFallback = () => createSampleState(timestamp, "custom-fallback-client");
const clearedSave = saveState(
  { read: () => null, write: () => {} },
  left.ok ? left.state : base,
  1,
  customFallback,
);
assert(
  !clearedSave.ok &&
    clearedSave.reason === "conflict" &&
    clearedSave.state.clientId === "custom-fallback-client",
  "A cleared store must use the caller's fallback state when reporting a conflict.",
);

const unavailableSave = saveState(
  { read: () => JSON.stringify(base), write: () => { throw new Error("Write denied"); } },
  left.ok ? left.state : base,
  base.revision,
);
assert(!unavailableSave.ok && unavailableSave.reason === "unavailable", "Thrown storage writes must be reported as unavailable.");

const bomImported = importState(`\uFEFF${portable}`);
assert(bomImported.notes["note-release"], "Imports should accept files with a UTF-8 BOM.");

console.log("CORE_STATE_TESTS_OK");
