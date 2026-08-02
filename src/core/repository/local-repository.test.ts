import { createSampleState } from "../sample-data";
import { createAppStore } from "../store";
import { createLocalRepository } from "./local-repository";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const timestamp = "2026-08-02T14:00:00.000Z";
let raw = JSON.stringify(createSampleState(timestamp, "repository-client"));
const storage = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};

const repository = createLocalRepository(createAppStore(storage));
const addedProject = repository.addProject({ id: "project-repository", name: "Repository project" });
assert(addedProject.ok, "Project creation should delegate to the local store.");

const addedTask = repository.addTask({
  id: "task-repository",
  content: "Repository task",
  projectId: "project-repository",
});
assert(addedTask.ok, "Task creation should delegate to the local store.");

const completed = repository.completeTask("task-repository");
assert(completed.ok && completed.state.tasks["task-repository"].completedAt, "Task completion should preserve store behavior.");

const undone = repository.undo();
assert(undone.ok && undone.state.tasks["task-repository"].completedAt === null, "Undo should use the store's durable undo behavior.");

const invalidMove = repository.updateTask("task-repository", { sectionId: "missing-section" });
assert(!invalidMove.ok && invalidMove.reason === "invalid", "Invalid task moves should retain store validation.");
const invalidRename = repository.updateTask("task-repository", { content: "   " });
assert(!invalidRename.ok && invalidRename.reason === "invalid", "Task edits must reject blank names.");

let notifications = 0;
const unsubscribe = repository.subscribe(() => {
  notifications += 1;
});
const renamed = repository.updateProject("project-repository", { name: "Renamed project" });
unsubscribe();
assert(renamed.ok && notifications === 1, "Repository subscriptions should proxy store notifications.");
assert(repository.getState().projects["project-repository"].name === "Renamed project", "Repository reads should expose the current store state.");

const section = repository.addSection({ id: "section-repository", projectId: "project-repository", name: "Today" });
assert(section.ok, "Repository should expose section creation.");
const moved = repository.bulkMove(["task-repository"], { projectId: "project-repository", sectionId: "section-repository" });
assert(moved.ok && moved.state.tasks["task-repository"].sectionId === "section-repository", "Repository should expose bulk moves.");
assert(repository.deleteSection("section-repository").ok, "Repository should expose section deletion.");
assert(repository.deleteProject("project-repository").ok, "Repository should expose project deletion.");

const conflictBase = createSampleState(timestamp, "conflict-client");
const externalWrite = createAppStore({
  read: () => JSON.stringify(conflictBase),
  write: () => {},
}).dispatch({ type: "task.add", input: { id: "task-first-writer", content: "First writer" } });
assert(externalWrite.ok, "Conflict setup should produce a newer state.");

let conflictReads = 0;
let simulateConcurrentWrite = false;
const conflictStorage = {
  read: () => {
    if (!simulateConcurrentWrite) return JSON.stringify(conflictBase);
    conflictReads += 1;
    return conflictReads === 1 ? JSON.stringify(conflictBase) : JSON.stringify(externalWrite.state);
  },
  write: () => {},
};
const stale = createLocalRepository(createAppStore(conflictStorage));
simulateConcurrentWrite = true;
const staleWrite = stale.addTask({ id: "task-stale-writer", content: "Stale writer" });
assert(!staleWrite.ok && staleWrite.reason === "conflict", "Repository writes must preserve revision conflict detection.");
assert(
  stale.getState().tasks["task-first-writer"] && !stale.getState().tasks["task-stale-writer"],
  "A conflict should reload the durable state returned by the local store.",
);

console.log("LOCAL_REPOSITORY_TESTS_OK");
