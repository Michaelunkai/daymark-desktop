import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

const root = new URL("../", import.meta.url);

test("remote sync contract is present in the client and Sites worker", async () => {
  const [sync, app, main, worker, hosting] = await Promise.all([
    readFile(new URL("./core/sync.ts", new URL("./src/", root)), "utf8"),
    readFile(new URL("./App.jsx", new URL("./src/", root)), "utf8"),
    readFile(new URL("./main.jsx", new URL("./src/", root)), "utf8"),
    readFile(new URL("./worker/index.js", root), "utf8"),
    readFile(new URL("./.openai/hosting.json", root), "utf8"),
  ]);
  assert.match(sync, /\/api\/sync\//);
  assert.match(sync, /expectedRevision/);
  assert.match(sync, /mergeSyncStates/);
  assert.match(sync, /rebaseSyncConflict/);
  assert.match(sync, /readSyncCookie/);
  assert.match(sync, /writeSyncCookie/);
  assert.match(sync, /BroadcastChannel/);
  assert.match(sync, /createInteractionSyncGate/);
  assert.match(sync, /createSyncPushSkipMarker/);
  assert.match(sync, /shouldSkipSyncPush/);
  assert.match(sync, /waitForSyncChange/);
  assert.match(sync, /const mergedReminders = newerRecord\(localReminders, remoteReminders\)/);
  assert.match(sync, /canonicalizeReminderTombstones/);
  assert.match(sync, /compareRecordAuthority/);
  assert.match(sync, /compareTombstoneAuthority/);
  assert.match(sync, /parseSyncEnvelope/);
  assert.match(sync, /mismatched state metadata/);
  assert.match(app, /interactionSyncGateRef\.current\.defer/);
  assert.match(app, /pushSyncStateWithRebase/);
  assert.match(app, /replaceFromSync\(nextState,\s*true\)/);
  assert.match(app, /waitForSyncChange/);
  assert.match(app, /controller\.abort/);
  assert.match(app, /syncPushRunnerRef/);
  assert.match(app, /syncPushRequestedRef/);
  assert.match(app, /syncPushRetryTimerRef/);
  assert.match(app, /syncGenerationRef/);
  assert.match(app, /syncRetryToken/);
  assert.match(app, /syncSkipPushMarkerRef/);
  assert.doesNotMatch(app, /syncSkipNextPushRef/);
  assert.doesNotMatch(app, /syncPushInFlightRef/);
  assert.doesNotMatch(app, /syncPushQueuedRef/);
  assert.doesNotMatch(app, /syncPushAbortRef/);
  assert.match(app, /while\s*\(\s*syncPushRequestedRef\.current/);
  assert.match(app, /syncPushRunnerRef\.current === runner/);
  assert.match(app, /syncPushRunnerRef\.current\?\.controller\.abort/);
  assert.match(app, /pushSyncStateWithRebase\([\s\S]*?syncRemoteRevisionRef\.current,[\s\S]*?8,/);
  assert.match(app, /setSyncRetryToken\(\(value\) => value \+ 1\)/);
  assert.match(app, /setTimeout\(resolve,\s*250\)/);
  assert.match(app, /pushSyncState/);
  assert.match(app, /}, 50\)/);
  assert.match(worker, /daymark_sync_states/);
  assert.match(worker, /handleSyncChanges/);
  assert.match(worker, /attempt < 80/);
  assert.match(worker, /sleep\(250\)/);
  assert.match(worker, /,\s*409\)/);
  assert.match(worker, /function mergeSyncStates/);
  assert.match(worker, /withPairingCookie/);
  assert.match(worker, /getCanonicalSyncKey/);
  assert.match(worker, /daymark_sync_config/);
  assert.match(worker, /ORDER BY revision DESC, updated_at DESC LIMIT 1/);
  assert.match(worker, /\/api\/sync\/pair-canonical/);
  assert.match(main, /daymark\.canonical-workspace=1/);
  assert.match(main, /pairCanonicalWorkspace\(\)/);
  assert.doesNotMatch(main, /await pairCanonicalWorkspace\(\)/);
  assert.match(main, /method:\s*'POST'/);
  assert.match(worker, /Set-Cookie/);
  assert.match(worker, /const nextRevision = Math\.max/);
  assert.match(worker, /applyTombstones/);
  assert.match(worker, /const mergedReminders = newerRecord\(localReminders, remoteReminders\)/);
  assert.match(worker, /canonicalizeReminderTombstones/);
  assert.match(worker, /INSERT OR IGNORE INTO daymark_sync_states/);
  assert.match(worker, /compareBinaryStrings/);
  assert.match(worker, /compareTombstoneAuthority/);
  assert.match(worker, /semanticReminderId/);
  assert.match(hosting, /"d1":\s*"DB"/);
});

const syncKey = "A1b2C3d4E5f6G7h8I9j0K_";
const initialState = {
  schemaVersion: 6,
  revision: 0,
  clientId: "worker-contract-client",
  updatedAt: "2026-08-20T00:00:00.000Z",
  projects: {},
  sections: {},
  filters: {},
  tasks: {},
  orderItems: {},
  notes: {},
  diaryEntries: {},
  reminders: {},
  preferences: {},
  undoStack: [],
};

class FirstWriteRaceDb {
  constructor() {
    this.row = null;
    this.currentReads = 0;
  }

  prepare(sql) {
    const db = this;
    const statement = {
      values: [],
      bind(...values) {
        statement.values = values;
        return statement;
      },
      async run() {
        if (sql.startsWith("CREATE TABLE")) return { meta: { changes: 0 } };
        if (sql.startsWith("INSERT OR IGNORE INTO daymark_sync_history")) {
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT OR IGNORE INTO daymark_sync_states")) {
          if (db.row) return { meta: { changes: 0 } };
          const [key, revision, stateJson, updatedAt] = statement.values;
          db.row = { sync_key: key, revision, state_json: stateJson, updated_at: updatedAt };
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected test SQL run: ${sql}`);
      },
      async first() {
        if (!sql.startsWith("SELECT revision, state_json, updated_at FROM daymark_sync_states")) {
          throw new Error(`Unexpected test SQL read: ${sql}`);
        }
        if (db.currentReads < 2) {
          db.currentReads += 1;
          return null;
        }
        return db.row;
      },
    };
    return statement;
  }
}

test("worker first-write races return one success and one conflict", async () => {
  const db = new FirstWriteRaceDb();
  const request = () => new Request(`https://daymark.example/api/sync/${syncKey}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: initialState, expectedRevision: 0 }),
  });

  const [first, second] = await Promise.all([
    worker.fetch(request(), { DB: db }),
    worker.fetch(request(), { DB: db }),
  ]);
  assert.deepEqual(
    [first.status, second.status].sort((left, right) => left - right),
    [200, 409],
    "Concurrent first writers must resolve as success plus conflict, never as a database error.",
  );

  const conflictResponse = first.status === 409 ? first : second;
  const conflict = await conflictResponse.json();
  assert.equal(conflict.error, "conflict");
  assert.equal(conflict.revision, 1);
  assert.equal(conflict.state.revision, 1);
});

test("worker reports a missing-state conflict instead of fabricating remote state", async () => {
  const db = new FirstWriteRaceDb();
  const response = await worker.fetch(
    new Request(`https://daymark.example/api/sync/${syncKey}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: initialState, expectedRevision: 4 }),
    }),
    { DB: db },
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "conflict",
    revision: 0,
    state: null,
  });
});
