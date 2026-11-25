import { createSampleState } from "./sample-data";
import { saveState } from "./storage";
import {
  canonicalizeReminderTombstones,
  canonicalizeReminders,
  compareBinaryStrings,
  compareTombstoneAuthority,
  semanticReminderId,
  stableSerialize,
} from "./reminder-identity";
import type { AppState } from "./types";
import {
  consumeRemoteAdoption,
  createInteractionSyncGate,
  createSyncPushSkipMarker,
  getSyncKey,
  mergeSyncStates,
  pullSyncState,
  pushSyncState,
  pairSyncKey,
  rebaseSyncConflict,
  shouldSkipSyncPush,
  syncStatesMatch,
  waitForSyncChange,
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

const reminderLocal = createSampleState(newer, "reminder-local-client");
reminderLocal.reminders["reminder-shared"] = {
  id: "reminder-shared",
  title: "Created on Android",
  details: "Show this reminder on every paired device.",
  target: { kind: "project", projectId: "project-personal", sectionId: "section-next", orderLane: null },
  eventAt: "2026-08-20T09:00:00.000Z",
  offsets: [{ id: "before-20", minutes: 20, direction: "before", sound: "alert" }],
  createdAt: older,
  updatedAt: newer,
};
const reminderRemote = createSampleState(older, "reminder-remote-client");
reminderRemote.reminders["reminder-shared"] = {
  ...reminderLocal.reminders["reminder-shared"],
  title: "Stale desktop copy",
  updatedAt: older,
};
reminderRemote.reminders["reminder-desktop"] = {
  ...reminderLocal.reminders["reminder-shared"],
  id: "reminder-desktop",
  title: "Created on Windows",
  updatedAt: newer,
};
const mergedReminders = mergeSyncStates(reminderLocal, reminderRemote);
assert(
  mergedReminders.reminders["reminder-shared"].title === "Created on Android",
  "An Android-created reminder must be visible on desktop and keep the newer edit.",
);
assert(
  mergedReminders.reminders["reminder-desktop"].title === "Created on Windows",
  "A desktop-created reminder must be visible on Android.",
);
const deletedReminderLocal = createSampleState(newer, "reminder-delete-client");
deletedReminderLocal.syncTombstones = {
  "reminders:reminder-shared": { deletedAt: newer },
};
const deletedReminderMerged = mergeSyncStates(deletedReminderLocal, reminderRemote);
assert(
  !deletedReminderMerged.reminders["reminder-shared"],
  "Deleting a reminder on either device must prevent an older copy from returning.",
);

const duplicateReminder = {
  id: "android-reminder",
  title: "Review project",
  details: "Open this on every paired device.",
  target: { kind: "project" as const, projectId: "project-personal", sectionId: "section-next", orderLane: null },
  eventAt: "2026-08-20T11:00:00+02:00",
  offsets: [
    { id: "after-10", minutes: 10, direction: "after" as const, sound: "alert" as const },
    { id: "before-20", minutes: 20, direction: "before" as const, sound: "soft" as const },
  ],
  createdAt: older,
  updatedAt: newer,
};
const duplicateReminderAlias = {
  ...duplicateReminder,
  id: "desktop-reminder",
  eventAt: "2026-08-20T09:00:00.000Z",
  offsets: [...duplicateReminder.offsets].reverse(),
};
const duplicateCanonical = canonicalizeReminders({
  [duplicateReminder.id]: duplicateReminder,
  [duplicateReminderAlias.id]: duplicateReminderAlias,
});
assert(
  Object.keys(duplicateCanonical).length === 1,
  "Semantically identical reminders with different device IDs must converge to one record.",
);
const duplicateSemanticId = semanticReminderId(duplicateReminder);
const aliasedTombstones = canonicalizeReminderTombstones(
  {
    "reminders:android-reminder": {
      deletedAt: newer,
      semanticId: duplicateSemanticId,
      aliases: ["android-reminder"],
    },
  },
  { [duplicateReminderAlias.id]: duplicateReminderAlias },
);
assert(
  aliasedTombstones[`reminders:${duplicateReminderAlias.id}`],
  "A reminder tombstone semantic alias must resolve to the surviving device ID.",
);
const deletedSemanticLocal = createSampleState(newer, "semantic-delete-client");
deletedSemanticLocal.syncTombstones = {
  "reminders:android-reminder": {
    deletedAt: newer,
    semanticId: duplicateSemanticId,
    aliases: ["android-reminder"],
  },
};
const duplicateRemote = createSampleState(older, "semantic-remote-client");
duplicateRemote.reminders[duplicateReminderAlias.id] = duplicateReminderAlias;
const deletedSemanticMerged = mergeSyncStates(deletedSemanticLocal, duplicateRemote);
assert(
  Object.keys(deletedSemanticMerged.reminders).length === 0,
  "A tombstone semantic alias must prevent a duplicate reminder from resurrecting.",
);
assert(compareBinaryStrings("Z", "a") < 0, "Tie-breaking must use binary ordering, not locale ordering.");
assert(
  stableSerialize({ a: 1, Z: 2 }) === '{"Z":2,"a":1}',
  "Stable serialization must use deterministic binary key ordering.",
);
const equalDeleteA = { deletedAt: newer, aliases: ["android-reminder"] };
const equalDeleteB = { deletedAt: newer, aliases: ["desktop-reminder"] };
assert(
  compareTombstoneAuthority(equalDeleteA, equalDeleteB) !== 0,
  "Equal deletion timestamps must still have a deterministic binary authority.",
);

const persistedReminderBeforeDelete = createSampleState(newer, "storage-delete-client");
persistedReminderBeforeDelete.reminders[duplicateReminder.id] = duplicateReminder;
const persistedReminderAfterDelete = structuredClone(persistedReminderBeforeDelete);
delete persistedReminderAfterDelete.reminders[duplicateReminder.id];
persistedReminderAfterDelete.revision += 1;
persistedReminderAfterDelete.syncTombstones = {
  "reminders:android-reminder": { deletedAt: newer },
};
let persistedRaw = JSON.stringify(persistedReminderBeforeDelete);
const persistedDelete = saveState(
  {
    read: () => persistedRaw,
    write: (value) => { persistedRaw = value; },
  },
  persistedReminderAfterDelete,
  persistedReminderBeforeDelete.revision,
);
const persistedTombstone = JSON.parse(persistedRaw).syncTombstones["reminders:android-reminder"];
assert(
  persistedDelete.ok &&
    persistedTombstone.semanticId === duplicateSemanticId &&
    persistedTombstone.aliases.includes("android-reminder"),
  "Durable reminder deletes must persist semantic tombstone aliases before sync.",
);

const priorFetch = globalThis.fetch;
const malformedStateResponse = async (response: Response): Promise<Error> => {
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => response });
  try {
    await pullSyncState("A1b2C3d4E5f6G7h8I9j0K_");
  } catch (error) {
    return error as Error;
  }
  throw new Error("Malformed sync response should be rejected.");
};
try {
  const malformedPull = await malformedStateResponse(
    new Response(JSON.stringify({ state: null, revision: 1 }), { status: 200 }),
  );
  assert(malformedPull.status === 200, "Malformed successful reads must expose the HTTP status.");

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response(JSON.stringify({ revision: 1 }), { status: 200 }),
  });
  let malformedPush: Error | null = null;
  try {
    await pushSyncState("A1b2C3d4E5f6G7h8I9j0K_", local, local.revision);
  } catch (error) {
    malformedPush = error as Error;
  }
  assert(malformedPush?.status === 200, "Malformed successful writes must be rejected.");

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response(
      JSON.stringify({ error: "conflict", revision: 0, state: null }),
      { status: 409 },
    ),
  });
  let missingStateConflict: (Error & { missingState?: boolean; state?: AppState | null }) | null = null;
  try {
    await pushSyncState("A1b2C3d4E5f6G7h8I9j0K_", local, local.revision);
  } catch (error) {
    missingStateConflict = error as typeof missingStateConflict;
  }
  assert(
    missingStateConflict?.code === "conflict" &&
      missingStateConflict.missingState === true &&
      missingStateConflict.state === null,
    "Missing remote state conflicts must remain explicit and non-fabricated.",
  );

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response(JSON.stringify({ state: null, revision: 1 }), { status: 200 }),
  });
  let malformedChange: Error | null = null;
  try {
    await waitForSyncChange("A1b2C3d4E5f6G7h8I9j0K_", 0);
  } catch (error) {
    malformedChange = error as Error;
  }
  assert(malformedChange?.status === 200, "Malformed successful change responses must be rejected.");
} finally {
  if (priorFetch) Object.defineProperty(globalThis, "fetch", { configurable: true, value: priorFetch });
  else delete (globalThis as { fetch?: unknown }).fetch;
}

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

const remoteAppliedState = createSampleState(newer, "remote-applied-client");
remoteAppliedState.revision = 40;
remoteAppliedState.updatedAt = newer;
const remoteSkipMarker = createSyncPushSkipMarker(remoteAppliedState);
assert(
  shouldSkipSyncPush(remoteSkipMarker, structuredClone(remoteAppliedState)),
  "The exact cloned state applied from remote sync must not be pushed back.",
);
const immediateLocalEdit = structuredClone(remoteAppliedState);
immediateLocalEdit.revision += 1;
immediateLocalEdit.updatedAt = "2026-08-04T10:00:02.000Z";
assert(
  !shouldSkipSyncPush(remoteSkipMarker, immediateLocalEdit),
  "A local edit immediately after remote sync must never be swallowed by the remote-state skip marker.",
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
