import { createSampleState } from "./sample-data";
import { mergeSyncStates } from "./sync";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const older = "2026-08-04T10:00:00.000Z";
const newer = "2026-08-04T10:00:01.000Z";

const local = createSampleState(newer, "local-client");
local.tasks["task-local"] = {
  ...local.tasks["task-welcome"],
  id: "task-local",
  content: "Created on Android",
  updatedAt: newer,
};
local.tasks["task-welcome"] = {
  ...local.tasks["task-welcome"],
  content: "Local edit",
  updatedAt: newer,
};

const remote = createSampleState(older, "remote-client");
remote.tasks["task-remote"] = {
  ...remote.tasks["task-welcome"],
  id: "task-remote",
  content: "Created on Windows",
  updatedAt: newer,
};
remote.tasks["task-welcome"] = {
  ...remote.tasks["task-welcome"],
  content: "Remote edit",
  updatedAt: older,
};

const merged = mergeSyncStates(local, remote);

assert(merged.clientId === "local-client", "Merged state should retain the local client identity.");
assert(merged.tasks["task-local"].content === "Created on Android", "Local-only changes should survive a merge.");
assert(merged.tasks["task-remote"].content === "Created on Windows", "Remote-only changes should survive a merge.");
assert(merged.tasks["task-welcome"].content === "Local edit", "The newer entity edit should win a merge.");

const deletedLocal = createSampleState(newer, "delete-client");
delete deletedLocal.tasks["task-welcome"];
deletedLocal.syncTombstones = {
  "tasks:task-welcome": { deletedAt: newer },
};
const staleRemote = createSampleState(older, "stale-client");
const deletionMerged = mergeSyncStates(deletedLocal, staleRemote);
assert(!deletionMerged.tasks["task-welcome"], "A newer deletion must not resurrect an older remote entity.");

const newerRemote = createSampleState(newer, "restore-client");
newerRemote.tasks["task-welcome"].updatedAt = newer;
const staleTombstoneLocal = createSampleState(older, "stale-delete-client");
staleTombstoneLocal.syncTombstones = {
  "tasks:task-welcome": { deletedAt: older },
};
const updateWins = mergeSyncStates(staleTombstoneLocal, newerRemote);
assert(updateWins.tasks["task-welcome"], "A newer entity update must survive an older deletion marker.");
