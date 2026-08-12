import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(sync, /waitForSyncChange/);
  assert.match(app, /interactionSyncGateRef\.current\.defer/);
  assert.match(app, /pushSyncStateWithRebase/);
  assert.match(app, /waitForSyncChange/);
  assert.match(app, /controller\.abort/);
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
  assert.match(hosting, /"d1":\s*"DB"/);
});
