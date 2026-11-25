#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDaymarkClient, DaymarkCliError } from "./client.mjs";
import { credentialStatus, getAgentToken, saveAgentTokenInteractively } from "./credential.mjs";

const RESOURCES = new Map([
  ["project", "projects"], ["projects", "projects"],
  ["section", "sections"], ["sections", "sections"],
  ["task", "tasks"], ["tasks", "tasks"],
  ["label", "labels"], ["labels", "labels"],
  ["filter", "filters"], ["filters", "filters"],
  ["note", "notes"], ["notes", "notes"],
  ["order-item", "order-items"], ["order-items", "order-items"],
]);
const BOOL_OPTIONS = new Set(["json", "confirm", "restore", "help"]);
const VALUE_OPTIONS = new Set(["project", "section", "status", "lane", "priority", "due", "time", "description", "data", "idempotency-key", "from", "to"]);

export async function run(argv = process.argv.slice(2), { output = console.log, error = console.error, fetchImpl } = {}) {
  const { words, options } = parseOptions(argv);
  const [command, ...args] = words;
  if (!command || command === "help" || options.help) return output(helpText());
  if (command === "auth") {
    if (args[0] === "login") return output(`Encrypted key saved at ${await saveAgentTokenInteractively()}`);
    if (args[0] === "status") return output(JSON.stringify(credentialStatus(), null, 2));
    throw new DaymarkCliError("Use 'daymark auth login' or 'daymark auth status'.");
  }

  const token = command === "schema" ? undefined : await getAgentToken();
  const client = createDaymarkClient({ token, fetchImpl, onMutationKey: (key) => error(`Idempotency-Key: ${key}`) });
  const { request, listAllTasks } = client;
  const mutation = { idempotencyKey: options["idempotency-key"] };
  let result;

  if (command === "schema") {
    result = await request("GET", "/api/agent/v1/openapi.json");
  } else if (command === "doctor") {
    result = {
      origin: client.origin,
      health: await request("GET", "/api/agent/v1/health"),
      ready: await request("GET", "/api/agent/v1/ready"),
      capabilities: await request("GET", "/api/agent/v1/capabilities"),
    };
  } else if (command === "projects") {
    result = await request("GET", "/api/agent/v1/projects");
  } else if (command === "project") {
    const project = await findRecord(client, "projects", args.join(" "));
    const sectionsResponse = await request("GET", "/api/agent/v1/sections");
    const sections = sectionsResponse.sections.filter((section) => section.projectId === project.id);
    const tasksResponse = await listAllTasks({ projectId: project.id, status: options.status || "all" });
    const section = options.section ? findInList(sections, options.section, "section") : null;
    result = { project, sections: section ? [section] : sections,
      tasks: section ? tasksResponse.tasks.filter((task) => task.sectionId === section.id) : tasksResponse.tasks,
      revision: tasksResponse.revision };
  } else if (command === "tasks") {
    const project = options.project ? await findRecord(client, "projects", options.project) : null;
    const page = await listAllTasks({ projectId: project?.id, status: options.status || "all" });
    let tasks = page.tasks;
    if (options.section) {
      if (!project) throw new DaymarkCliError("--section requires --project.");
      const sections = (await request("GET", "/api/agent/v1/sections")).sections;
      const section = findInList(sections.filter((item) => item.projectId === project.id), options.section, "section");
      tasks = tasks.filter((task) => task.sectionId === section.id);
    }
    result = { tasks, total: tasks.length, revision: page.revision };
  } else if (command === "order") {
    if (args[0] === "add") {
      if (!args[1]) throw new DaymarkCliError("Give the Order item title.");
      const lane = parseLane(options.lane || "now");
      result = await request("POST", "/api/agent/v1/order-items", { body: { title: args.slice(1).join(" "), lane }, ...mutation });
    } else {
      const page = await request("GET", "/api/agent/v1/order-items");
      const lane = options.lane ? parseLane(options.lane) : null;
      const items = page.items.filter((item) => (!lane || item.lane === lane) && (!options.status || item.status === options.status));
      result = { items, total: items.length, revision: page.revision };
    }
  } else if (command === "task" && args[0] === "add") {
    if (!args[1]) throw new DaymarkCliError("Give the task title.");
    const project = options.project ? await findRecord(client, "projects", options.project) : null;
    if (options.section && !project) throw new DaymarkCliError("--section requires --project.");
    const sections = options.section ? (await request("GET", "/api/agent/v1/sections")).sections : [];
    const section = options.section ? findInList(sections.filter((item) => item.projectId === project.id), options.section, "section") : null;
    const body = { title: args.slice(1).join(" ") };
    if (project) body.projectId = project.id;
    if (section) body.sectionId = section.id;
    if (options.description) body.description = options.description;
    if (options.priority) body.priority = Number(options.priority);
    if (options.due) body.due = { date: options.due, time: options.time || null };
    result = await request("POST", "/api/agent/v1/tasks", { body, ...mutation });
  } else if (command === "search") {
    if (!args.length) throw new DaymarkCliError("Give a search query.");
    result = await request("GET", `/api/agent/v1/search?q=${encodeURIComponent(args.join(" "))}`);
  } else if (command === "calendar") {
    const query = new URLSearchParams();
    if (options.from) query.set("from", options.from);
    if (options.to) query.set("to", options.to);
    result = await request("GET", `/api/agent/v1/calendar?${query}`);
  } else if (command === "diary") {
    if (args[0] === "set") {
      const date = encodeURIComponent(required(args[1], "diary date"));
      result = await request("PUT", `/api/agent/v1/diary/${date}`, { body: await readData(options.data), ...mutation });
    } else if (args[0] === "delete") {
      if (!options.confirm) throw new DaymarkCliError("Deletion needs --confirm. The API returns an undo ID.");
      const date = encodeURIComponent(required(args[1], "diary date"));
      result = await request("POST", `/api/agent/v1/diary/${date}/delete`, { body: { confirm: "delete" }, ...mutation });
    } else {
      result = await request("GET", args[0] ? `/api/agent/v1/diary/${encodeURIComponent(args[0])}` : "/api/agent/v1/diary");
    }
  } else if (command === "preferences" || command === "prefs") {
    if (!args.length) result = await request("GET", "/api/agent/v1/preferences");
    else if (args[0] === "set") result = await request("PATCH", "/api/agent/v1/preferences", { body: await readData(options.data), ...mutation });
    else throw new DaymarkCliError("Use 'daymark prefs' or 'daymark prefs set --data JSON'.");
  } else if (command === "list") {
    const resource = resourceName(args[0]);
    result = resource === "tasks" ? await listAllTasks({ status: options.status || "all" }) : await request("GET", `/api/agent/v1/${resource}`);
  } else if (command === "get") {
    result = await request("GET", `/api/agent/v1/${resourceName(args[0])}/${encodeURIComponent(required(args[1], "record ID"))}`);
  } else if (command === "create") {
    result = await request("POST", `/api/agent/v1/${resourceName(args[0])}`, { body: await readData(options.data), ...mutation });
  } else if (command === "update") {
    result = await request("PATCH", `/api/agent/v1/${resourceName(args[0])}/${encodeURIComponent(required(args[1], "record ID"))}`, { body: await readData(options.data), ...mutation });
  } else if (command === "delete") {
    if (!options.confirm) throw new DaymarkCliError("Deletion needs --confirm. The API returns an undo ID.");
    result = await request("POST", `/api/agent/v1/${resourceName(args[0])}/${encodeURIComponent(required(args[1], "record ID"))}/delete`, { body: { confirm: "delete" }, ...mutation });
  } else if (command === "complete" || command === "reopen") {
    const resource = resourceName(args[0]);
    if (!["tasks", "notes"].includes(resource)) throw new DaymarkCliError("Only tasks and notes support complete/reopen.");
    result = await request("POST", `/api/agent/v1/${resource}/${encodeURIComponent(required(args[1], "record ID"))}/${command}`, mutation);
  } else if (command === "archive") {
    result = await request("POST", `/api/agent/v1/projects/${encodeURIComponent(required(args[0], "project ID"))}/archive`, { body: { archived: !options.restore }, ...mutation });
  } else if (command === "undo") {
    result = await request("POST", `/api/agent/v1/undo/${encodeURIComponent(required(args[0], "undo ID"))}`, mutation);
  } else if (command === "api") {
    result = await request(required(args[0], "HTTP method"), required(args[1], "API path"), {
      ...(options.data ? { body: await readData(options.data) } : {}), ...mutation,
    });
  } else {
    throw new DaymarkCliError(`Unknown command: ${command}. Run 'daymark help'.`);
  }
  output(options.json ? JSON.stringify(result, null, 2) : formatResult(result));
  return result;
}

function parseOptions(argv) {
  const words = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith("--")) { words.push(value); continue; }
    const [name, inline] = value.slice(2).split(/=(.*)/s, 2);
    if (BOOL_OPTIONS.has(name)) { options[name] = true; continue; }
    if (!VALUE_OPTIONS.has(name)) throw new DaymarkCliError(`Unknown option: --${name}`);
    const next = inline === undefined ? argv[++i] : inline;
    if (next === undefined || next.startsWith("--")) throw new DaymarkCliError(`--${name} needs a value.`);
    options[name] = next;
  }
  return { words, options };
}

function required(value, label) {
  if (!value) throw new DaymarkCliError(`Give a ${label}.`);
  return value;
}

function resourceName(value) {
  const resource = RESOURCES.get(value);
  if (!resource) throw new DaymarkCliError("Resource must be projects, sections, tasks, labels, filters, notes, or order-items.");
  return resource;
}

async function readData(value) {
  if (!value) throw new DaymarkCliError("Use --data with JSON, @file, or - for stdin.");
  const text = value === "-" ? await readStdin() : value.startsWith("@") ? await readFile(value.slice(1), "utf8") : value;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new DaymarkCliError("--data must be a JSON object."); }
}

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function findRecord(client, resource, nameOrId) {
  required(nameOrId, resource === "projects" ? "project name or ID" : "record name or ID");
  const records = (await client.request("GET", `/api/agent/v1/${resource}`))[resource];
  return findInList(records, nameOrId, resource);
}

function findInList(records, nameOrId, kind) {
  const matches = records.filter((item) => item.id === nameOrId || item.name?.toLocaleLowerCase() === nameOrId.toLocaleLowerCase());
  if (!matches.length) throw new DaymarkCliError(`${kind} '${nameOrId}' was not found.`);
  if (matches.length > 1) throw new DaymarkCliError(`${kind} '${nameOrId}' is ambiguous; use its ID.`);
  return matches[0];
}

function parseLane(value) {
  const key = value.toLocaleLowerCase().replace(/[^a-z]/g, "");
  const lane = { now: "now", donow: "now", later: "later", after: "after", before: "before" }[key];
  if (!lane) throw new DaymarkCliError("Order lane must be 'Do now', Later, After, or Before.");
  return lane;
}

function formatResult(value) {
  const key = ["tasks", "projects", "sections", "items", "labels", "filters", "notes", "entries", "results"].find((name) => Array.isArray(value?.[name]));
  if (!key) return JSON.stringify(value, null, 2);
  const lines = value[key].map((item) => {
    const title = item.content ?? item.title ?? item.name ?? item.date ?? item.id;
    const details = [item.lane, item.status, item.due?.date, item.completedAt ? "completed" : null].filter(Boolean).join(" · ");
    return `${title}  [${item.id ?? ""}]${details ? `  ${details}` : ""}`;
  });
  return `${lines.join("\n")}${lines.length ? "\n" : ""}${lines.length} ${key} (revision ${value.revision ?? "unknown"})`;
}

function helpText() {
  return `Daymark CLI — live workspace data, no local cache

Setup: In Daymark Settings create a Daymark AI key, then run: daymark auth login
       For automation, set DAYMARK_AI_TOKEN in the environment.

Reads: daymark doctor | projects | project NAME [--section NAME]
       daymark tasks [--project NAME] [--section NAME] [--status open|completed|all]
       daymark order [--lane "Do now"|Later|After|Before]
       daymark search WORDS | calendar [--from DATE] [--to DATE] | diary [DATE] | prefs
       daymark list RESOURCE | get RESOURCE ID | schema

Writes: daymark task add TITLE [--project NAME] [--section NAME] [--due DATE] [--time HH:MM]
        daymark order add TITLE [--lane NAME]
        daymark create RESOURCE --data '{"name":"..."}'
        daymark update RESOURCE ID --data @file.json
        daymark complete tasks|notes ID | reopen tasks|notes ID
        daymark diary set DATE --data @file.json | diary delete DATE --confirm
        daymark prefs set --data '{"theme":"dark"}'
        daymark archive PROJECT_ID [--restore] | delete RESOURCE ID --confirm | undo UNDO_ID

All API operations: daymark api GET|POST|PUT|PATCH|DELETE /api/agent/v1/PATH [--data @file.json]
Add --json for machine output. Writes print an idempotency key for safe retries.
RESOURCE: projects, sections, tasks, labels, filters, notes, order-items.`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  run().catch((cause) => {
    console.error(`Daymark CLI: ${cause.message}`);
    if (cause.idempotencyKey) console.error(`Retry with --idempotency-key ${cause.idempotencyKey} after checking live state.`);
    process.exitCode = 1;
  });
}
