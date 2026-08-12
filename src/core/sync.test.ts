import { createSampleState } from "./sample-data";
import {
  consumeRemoteAdoption,
  createInteractionSyncGate,
  getSyncKey,
  mergeSyncStates,
  pairSyncKey,
  rebaseSyncConflict,
  syncStatesMatch,
} from "./sync";

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

const rebased = rebaseSyncConflict(local, remote, 41, "2026-08-04T10:00:02.000Z");
assert(rebased.revision === 42, "A conflict rebase must advance beyond the remote revision.");
assert(rebased.updatedAt === "2026-08-04T10:00:02.000Z", "A conflict rebase must receive a fresh timestamp.");
assert(rebased.tasks["task-local"], "A conflict rebase must retain Android-only data.");
assert(rebased.tasks["task-remote"], "A conflict rebase must retain website-only data.");

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

assert(syncStatesMatch(local, local), "A state should match itself.");
assert(
  syncStatesMatch(local, { ...local, revision: 42, clientId: "other-client", updatedAt: older }),
  "Transport metadata should not create a content conflict.",
);
assert(
  !syncStatesMatch(local, { ...local, tasks: { ...local.tasks, "task-extra": local.tasks["task-welcome"] } }),
  "Different entity content must remain detectable.",
);

const interactionGate = createInteractionSyncGate<string>();
assert(
  interactionGate.setInteractionOpen(true) === null,
  "Opening a protected interaction must not flush state.",
);
assert(
  interactionGate.defer("remote-during-transfer", 12),
  "Remote state must be deferred while a transfer interaction is open.",
);
assert(
  interactionGate.defer("newer-remote-during-transfer", 13),
  "The newest remote state must replace an older deferred state.",
);
const deferredRemote = interactionGate.setInteractionOpen(false);
assert(
  deferredRemote?.state === "newer-remote-during-transfer" && deferredRemote.revision === 13,
  "Closing a protected interaction must flush its newest deferred remote state.",
);
assert(
  interactionGate.setInteractionOpen(false) === null,
  "A deferred remote state must flush only once.",
);

const pairingCode = "A1b2C3d4E5f6G7h8I9j0K_";
const storageEntries = new Map<string, string>([["daymark.sync-key", "old-desktop-sync-key"]]);
const pairingStorage = {
  getItem: (key: string) => storageEntries.get(key) ?? null,
  setItem: (key: string, value: string) => storageEntries.set(key, value),
  removeItem: (key: string) => storageEntries.delete(key),
};
const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const cookieDocument = { cookie: "" };
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { search: `?sync=${pairingCode}` } },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: cookieDocument,
});
try {
  assert(
    getSyncKey(pairingStorage) === pairingCode,
    "An accepted pairing URL must become the active sync workspace.",
  );
  assert(
    consumeRemoteAdoption(pairingCode, pairingStorage),
    "Joining a different existing workspace must explicitly adopt its remote data first.",
  );
  assert(
    !consumeRemoteAdoption(pairingCode, pairingStorage),
    "Remote adoption must be consumed once so ordinary later reloads merge normally.",
  );
  assert(
    cookieDocument.cookie.includes(`daymark.sync-key=${pairingCode}`),
    "An explicit pairing URL must persist a durable first-party pairing cookie.",
  );

  storageEntries.set("daymark.sync-key", "stale-demo-sync-key");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { search: "" } },
  });
  assert(
    getSyncKey(pairingStorage) === pairingCode,
    "The durable pairing cookie must override stale demo local storage on the clean root URL.",
  );
  assert(
    consumeRemoteAdoption(pairingCode, pairingStorage),
    "Recovering from stale demo storage must adopt the authoritative remote workspace.",
  );

  storageEntries.clear();
  cookieDocument.cookie = "";
  const freshWorkspaceCode = getSyncKey(pairingStorage);
  assert(
    /^[A-Za-z0-9_-]{22}$/.test(freshWorkspaceCode),
    "A browser without pairing storage must create a valid isolated workspace.",
  );
  assert(
    storageEntries.get("daymark.sync-key") === freshWorkspaceCode,
    "A newly created workspace must be persisted for reliable future sync.",
  );
  assert(
    !consumeRemoteAdoption(freshWorkspaceCode, pairingStorage),
    "A newly created workspace must not attempt to adopt unrelated remote data.",
  );
  assert(
    pairSyncKey(`https://daymark.example/?sync=${pairingCode}`, pairingStorage) === pairingCode,
    "A copied pairing link must be accepted when browser storage needs recovery.",
  );
  assert(
    consumeRemoteAdoption(pairingCode, pairingStorage),
    "Manual pairing must replace local data with the authoritative remote workspace first.",
  );
  assert(
    pairSyncKey("not-a-pairing-code", pairingStorage) === null,
    "Invalid pairing input must not change the active workspace.",
  );
} finally {
  if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
  else delete (globalThis as { window?: unknown }).window;
  if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
  else delete (globalThis as { document?: unknown }).document;
}
