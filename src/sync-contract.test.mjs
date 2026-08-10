import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("remote sync contract is present in the client and Sites worker", async () => {
  const [sync, app, worker, hosting] = await Promise.all([
    readFile(new URL("./core/sync.ts", new URL("./src/", root)), "utf8"),
    readFile(new URL("./App.jsx", new URL("./src/", root)), "utf8"),
    readFile(new URL("./worker/index.js", root), "utf8"),
    readFile(new URL("./.openai/hosting.json", root), "utf8"),
  ]);
  assert.match(sync, /\/api\/sync\//);
  assert.match(sync, /expectedRevision/);
  assert.match(sync, /mergeSyncStates/);
  assert.match(sync, /BroadcastChannel/);
  assert.match(sync, /createInteractionSyncGate/);
  assert.match(app, /interactionSyncGateRef\.current\.defer/);
  assert.match(app, /taskEditorOpenRef\.current\s*\?\s*15000/);
  assert.match(app, /setTimeout/);
  assert.match(app, /pushSyncState/);
  assert.match(app, /}, 50\)/);
  assert.match(worker, /daymark_sync_states/);
  assert.match(worker, /,\s*409\)/);
  assert.match(worker, /function mergeSyncStates/);
  assert.match(worker, /const nextRevision = Math\.max/);
  assert.match(worker, /applyTombstones/);
  assert.match(hosting, /"d1":\s*"DB"/);
});
