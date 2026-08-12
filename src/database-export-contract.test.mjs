import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", import.meta.url);

test("repository database contains the complete Android-authoritative workspace", async () => {
  const document = JSON.parse(
    await readFile(new URL("./data/daymark-workspace.json", root), "utf8"),
  );
  assert.equal(document.format, "daymark-workspace-database");
  assert.equal(document.source, "android-authoritative-sync-workspace");
  assert.equal(document.revision, 1875);
  assert.equal(Object.keys(document.state.projects).length, 8);
  assert.equal(Object.keys(document.state.sections).length, 8);
  assert.equal(Object.keys(document.state.labels).length, 4);
  assert.equal(Object.keys(document.state.filters).length, 1);
  assert.equal(Object.keys(document.state.tasks).length, 175);
  assert.equal(Object.keys(document.state.orderItems).length, 9);
  assert.equal(Object.keys(document.state.notes).length, 1);
  assert.equal(Object.keys(document.state.diaryEntries).length, 2);
  assert.equal(Object.keys(document.state.syncTombstones).length, 140);

  const database = new DatabaseSync(
    fileURLToPath(new URL("./data/daymark.sqlite", root)),
    { readOnly: true },
  );
  try {
    const snapshot = database
      .prepare("SELECT revision, state_json FROM workspace_snapshot WHERE id = 1")
      .get();
    assert.equal(Number(snapshot.revision), document.revision);
    assert.deepEqual(JSON.parse(snapshot.state_json), document.state);
  } finally {
    database.close();
  }
});
