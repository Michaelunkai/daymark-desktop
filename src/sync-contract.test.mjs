import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("remote sync contract is present in the client and Sites worker", async () => {
  const [client, worker, hosting] = await Promise.all([
    readFile(new URL("./core/sync.ts", new URL("./src/", root)), "utf8"),
    readFile(new URL("./worker/index.js", root), "utf8"),
    readFile(new URL("./.openai/hosting.json", root), "utf8"),
  ]);
  assert.match(client, /\/api\/sync\//);
  assert.match(client, /expectedRevision/);
  assert.match(worker, /daymark_sync_states/);
  assert.match(worker, /,\s*409\)/);
  assert.match(hosting, /"d1":\s*"DB"/);
});
