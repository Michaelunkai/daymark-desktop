import assert from "node:assert/strict";
import test from "node:test";
import { createDaymarkClient } from "./client.mjs";
import { run } from "./daymark.mjs";

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("reads every task page from one live revision", async () => {
  const seen = [];
  const client = createDaymarkClient({
    apiUrl: "http://localhost:8787",
    token: "test-secret",
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), init });
      const offset = Number(url.searchParams.get("offset"));
      const tasks = Array.from({ length: offset ? 2 : 250 }, (_, index) => ({ id: `task-${offset + index}` }));
      return response({ tasks, total: 252, nextOffset: offset ? null : 250, revision: 7 });
    },
  });
  const result = await client.listAllTasks({ projectId: "project-one" });
  assert.equal(result.tasks.length, 252);
  assert.equal(result.total, 252);
  assert.equal(seen.length, 2);
  assert.ok(seen.every(({ init }) => init.headers.Authorization === "Bearer test-secret" && init.cache === "no-store" && init.redirect === "error"));
  assert.ok(seen.every(({ url }) => url.includes("projectId=project-one")));
});

test("stops when the workspace revision changes during pagination", async () => {
  const client = createDaymarkClient({
    apiUrl: "http://localhost:8787",
    token: "test-secret",
    fetchImpl: async (url) => response({ tasks: Array.from({ length: 250 }, (_, index) => ({ id: String(index) })), nextOffset: Number(url.searchParams.get("offset")) ? null : 250, revision: Number(url.searchParams.get("offset")) ? 2 : 1 }),
  });
  await assert.rejects(client.listAllTasks(), /workspace changed during paging/i);
});

test("refuses paths that could leak a Daymark AI key to another endpoint", async () => {
  const client = createDaymarkClient({ apiUrl: "https://daymark.example", token: "test-secret", fetchImpl: () => { throw new Error("should not fetch"); } });
  await assert.rejects(client.request("GET", "https://evil.example/api/agent/v1/tasks"), /path must start/i);
  await assert.rejects(client.request("GET", "/api/agent/v1/../../sync/key"), /leaves the configured Daymark origin/i);
});

test("the project view resolves a named section and reads its current tasks", async () => {
  const previous = process.env.DAYMARK_AI_TOKEN;
  process.env.DAYMARK_AI_TOKEN = "test-secret";
  const output = [];
  try {
    const result = await run(["project", "Daymark", "--section", "Pc", "--json"], {
      output: (text) => output.push(text),
      error: () => {},
      fetchImpl: async (url) => {
        if (url.pathname.endsWith("/projects")) return response({ projects: [{ id: "project-1", name: "Daymark" }] });
        if (url.pathname.endsWith("/sections")) return response({ sections: [{ id: "section-1", projectId: "project-1", name: "Pc" }, { id: "section-2", projectId: "project-1", name: "Android" }] });
        if (url.pathname.endsWith("/tasks")) return response({ tasks: [{ id: "task-1", sectionId: "section-1" }, { id: "task-2", sectionId: "section-2" }], revision: 4 });
        throw new Error(`Unexpected path: ${url.pathname}`);
      },
    });
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].id, "task-1");
    assert.equal(JSON.parse(output[0]).sections[0].name, "Pc");
  } finally {
    if (previous === undefined) delete process.env.DAYMARK_AI_TOKEN;
    else process.env.DAYMARK_AI_TOKEN = previous;
  }
});

test("writes include a recoverable idempotency key and keep delete explicit", async () => {
  const previous = process.env.DAYMARK_AI_TOKEN;
  process.env.DAYMARK_AI_TOKEN = "test-secret";
  const seen = [];
  const errors = [];
  try {
    await assert.rejects(run(["delete", "tasks", "task-one"], { output: () => {}, error: () => {}, fetchImpl: () => { throw new Error("should not fetch"); } }), /--confirm/);
    await run(["task", "add", "Write release notes", "--project", "Daymark", "--section", "Pc"], {
      output: () => {}, error: (text) => errors.push(text),
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        if (url.pathname.endsWith("/projects")) return response({ projects: [{ id: "project-one", name: "Daymark" }] });
        if (url.pathname.endsWith("/sections")) return response({ sections: [{ id: "section-one", projectId: "project-one", name: "Pc" }] });
        return response({ task: { id: "task-new" }, revision: 5 }, 201);
      },
    });
    const write = seen.find(({ init }) => init.method === "POST");
    assert.equal(write.init.headers.Authorization, "Bearer test-secret");
    assert.match(write.init.headers["Idempotency-Key"], /^[0-9a-f-]{36}$/i);
    assert.equal(JSON.parse(write.init.body).sectionId, "section-one");
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].includes("test-secret"));
  } finally {
    if (previous === undefined) delete process.env.DAYMARK_AI_TOKEN;
    else process.env.DAYMARK_AI_TOKEN = previous;
  }
});

test("diary and preferences have direct commands with guarded writes", async () => {
  const previous = process.env.DAYMARK_AI_TOKEN;
  process.env.DAYMARK_AI_TOKEN = "test-secret";
  const seen = [];
  const invoke = (args) => run(args, {
    output: () => {}, error: () => {},
    fetchImpl: async (url, init) => {
      seen.push({ path: url.pathname, method: init.method, body: init.body, key: init.headers["Idempotency-Key"] });
      return response({ revision: 9 });
    },
  });
  try {
    await invoke(["prefs"]);
    await invoke(["prefs", "set", "--data", '{"theme":"dark"}']);
    await invoke(["diary", "set", "2026-09-24", "--data", '{"content":"Today"}']);
    await assert.rejects(invoke(["diary", "delete", "2026-09-24"]), /--confirm/);
    await invoke(["diary", "delete", "2026-09-24", "--confirm"]);
    assert.deepEqual(seen.map(({ method, path }) => [method, path]), [
      ["GET", "/api/agent/v1/preferences"],
      ["PATCH", "/api/agent/v1/preferences"],
      ["PUT", "/api/agent/v1/diary/2026-09-24"],
      ["POST", "/api/agent/v1/diary/2026-09-24/delete"],
    ]);
    assert.deepEqual(JSON.parse(seen[3].body), { confirm: "delete" });
    assert.ok(seen.slice(1).every(({ key }) => /^[0-9a-f-]{36}$/i.test(key)));
  } finally {
    if (previous === undefined) delete process.env.DAYMARK_AI_TOKEN;
    else process.env.DAYMARK_AI_TOKEN = previous;
  }
});
