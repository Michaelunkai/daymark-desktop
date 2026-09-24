import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("The packaged CLI proof requires Windows.");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = process.env.DAYMARK_PACKAGED_CLI_PATH
  ?? path.join(root, "release", "windows", "win-unpacked", "daymark.cmd");
const token = "packaged-cli-proof-token";
const seen = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  seen.push({ method: request.method, path: url.pathname, offset: url.searchParams.get("offset"),
    authorization: request.headers.authorization, idempotencyKey: request.headers["idempotency-key"], body });
  response.setHeader("Content-Type", "application/json");
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/agent/v1/projects") {
    response.writeHead(200).end(JSON.stringify({ projects: [{ id: "project-1", name: "Daymark" }], revision: 7 }));
  } else if (request.method === "GET" && url.pathname === "/api/agent/v1/tasks") {
    const offset = Number(url.searchParams.get("offset"));
    const count = offset === 0 ? 250 : 2;
    const tasks = Array.from({ length: count }, (_, index) => ({ id: `task-${offset + index}`, title: `Task ${offset + index}` }));
    response.writeHead(200).end(JSON.stringify({ tasks, revision: 7, total: 252, nextOffset: offset === 0 ? 250 : null }));
  } else if (request.method === "POST" && url.pathname === "/api/agent/v1/tasks") {
    response.writeHead(201).end(JSON.stringify({ task: { id: "task-created", ...JSON.parse(body) }, revision: 8 }));
  } else {
    response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const env = { ...process.env, DAYMARK_API_URL: `http://127.0.0.1:${address.port}`, DAYMARK_AI_TOKEN: token };

function invoke(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(wrapper, args, {
      env, cwd: root, windowsHide: true, shell: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`Packaged CLI exited ${code}: ${stderr}`)));
  });
}

try {
  const projects = JSON.parse((await invoke(["projects", "--json"])).stdout);
  assert.equal(projects.projects[0].name, "Daymark");
  const tasks = JSON.parse((await invoke(["tasks", "--json"])).stdout);
  assert.equal(tasks.tasks.length, 252);
  assert.equal(tasks.total, 252);
  const write = await invoke(["task", "add", '"Packaged CLI proof"', "--project", "Daymark", "--json"]);
  assert.equal(JSON.parse(write.stdout).task.id, "task-created");
  assert.match(write.stderr, /Idempotency-Key: [0-9a-f-]{36}/i);
  assert.equal(seen.filter((item) => item.path === "/api/agent/v1/tasks" && item.method === "GET").length, 2);
  assert.ok(seen.every((item) => item.authorization === `Bearer ${token}`));
  assert.equal(JSON.parse(seen.at(-1).body).projectId, "project-1");
  assert.match(seen.at(-1).idempotencyKey, /^[0-9a-f-]{36}$/i);
  console.log("PACKAGED_DAYMARK_CLI_OK", JSON.stringify({ wrapper, tasks: tasks.tasks.length, requests: seen.length }));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
