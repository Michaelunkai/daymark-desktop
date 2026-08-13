import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env.DAYMARK_RUNTIME_EXECUTABLE_PATH
  ?? path.join(root, "release", "windows", "win-unpacked", "Daymark Runtime.exe");
const profilePath = path.join(root, "release", "windows", "evidence", "sync-profile");
const origin = "https://daymark-desktop.michaelovsky55555.chatgpt.site";
const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const windowsTitle = `Daymark Windows sync verification ${runId}`;
const remoteTitle = `Daymark remote sync verification ${runId}`;

await mkdir(path.dirname(profilePath), { recursive: true });
await rm(profilePath, { recursive: true, force: true });

const desktop = await electron.launch({
  executablePath,
  args: ["--daymark-detached-child"],
  env: { ...process.env, DAYMARK_USER_DATA_DIR: profilePath },
  timeout: 60000,
});

async function readRemote(key) {
  const response = await fetch(`${origin}/api/sync/${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Remote read failed (${response.status}).`);
  return response.json();
}

async function writeRemote(key, payload, expectedRevision) {
  const response = await fetch(`${origin}/api/sync/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision, state: payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Remote write failed (${response.status}).`);
  return result;
}

async function pollRemote(key, predicate, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await readRemote(key);
    if (predicate(payload.state)) return payload;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the remote sync state.");
}

try {
  const page = await desktop.firstWindow({ timeout: 60000 });
  await page.waitForFunction(() => {
    const state = window.DaymarkAI?.getState?.();
    return Number(state?.revision ?? 0) >= 1800 && Object.keys(state?.tasks ?? {}).length >= 170;
  }, null, { timeout: 60000 });

  const key = await page.evaluate(() => localStorage.getItem("daymark.sync-key"));
  if (!/^[A-Za-z0-9_-]{22}$/.test(key ?? "")) throw new Error("Invalid runtime sync key.");
  const baseline = await readRemote(key);
  const baselineCounts = {
    projects: Object.keys(baseline.state.projects ?? {}).length,
    tasks: Object.keys(baseline.state.tasks ?? {}).length,
    orderItems: Object.keys(baseline.state.orderItems ?? {}).length,
  };

  const windowsResult = await page.evaluate((content) => window.DaymarkAI.dispatch({
    type: "task.add",
    input: { content, description: "Temporary automated sync verification record." },
  }), windowsTitle);
  if (!windowsResult?.ok) throw new Error("Windows task creation was rejected.");
  const windowsRemote = await pollRemote(
    key,
    (state) => Object.values(state.tasks ?? {}).some((task) => task.content === windowsTitle),
  );
  const windowsTask = Object.values(windowsRemote.state.tasks).find((task) => task.content === windowsTitle);
  await page.evaluate((taskId) => window.DaymarkAI.dispatch({ type: "task.delete", taskId }), windowsTask.id);
  await pollRemote(
    key,
    (state) => !Object.values(state.tasks ?? {}).some((task) => task.content === windowsTitle),
  );

  const beforeRemoteAdd = await readRemote(key);
  const template = structuredClone(Object.values(beforeRemoteAdd.state.tasks)[0]);
  const remoteTaskId = `windows-sync-${runId}`;
  const now = new Date().toISOString();
  const remoteState = structuredClone(beforeRemoteAdd.state);
  remoteState.tasks[remoteTaskId] = {
    ...template,
    id: remoteTaskId,
    content: remoteTitle,
    description: "Temporary automated reverse-sync verification record.",
    projectId: remoteState.preferences.inboxProjectId,
    sectionId: null,
    completedAt: null,
    due: null,
    createdAt: now,
    updatedAt: now,
  };
  remoteState.revision = Number(beforeRemoteAdd.revision) + 1;
  remoteState.updatedAt = now;
  await writeRemote(key, remoteState, Number(beforeRemoteAdd.revision));
  await page.waitForFunction(
    (content) => Object.values(window.DaymarkAI?.getState?.().tasks ?? {}).some((task) => task.content === content),
    remoteTitle,
    { timeout: 60000 },
  );

  const beforeCleanup = await readRemote(key);
  const cleanupState = structuredClone(beforeCleanup.state);
  delete cleanupState.tasks[remoteTaskId];
  cleanupState.syncTombstones = {
    ...(cleanupState.syncTombstones ?? {}),
    [`tasks:${remoteTaskId}`]: { deletedAt: new Date().toISOString() },
  };
  cleanupState.revision = Number(beforeCleanup.revision) + 1;
  cleanupState.updatedAt = new Date().toISOString();
  await writeRemote(key, cleanupState, Number(beforeCleanup.revision));
  await page.waitForFunction(
    (content) => !Object.values(window.DaymarkAI?.getState?.().tasks ?? {}).some((task) => task.content === content),
    remoteTitle,
    { timeout: 60000 },
  );

  const final = await readRemote(key);
  const finalCounts = {
    projects: Object.keys(final.state.projects ?? {}).length,
    tasks: Object.keys(final.state.tasks ?? {}).length,
    orderItems: Object.keys(final.state.orderItems ?? {}).length,
  };
  if (JSON.stringify(finalCounts) !== JSON.stringify(baselineCounts)) {
    throw new Error(`User-visible counts changed: ${JSON.stringify({ baselineCounts, finalCounts })}`);
  }
  console.log(JSON.stringify({
    ok: true,
    windowsToRemote: true,
    remoteToWindows: true,
    baselineRevision: baseline.revision,
    finalRevision: final.revision,
    baselineCounts,
    finalCounts,
    temporaryRecordsRemaining: Object.values(final.state.tasks ?? {})
      .filter((task) => task.content === windowsTitle || task.content === remoteTitle).length,
  }));
} finally {
  await desktop.close();
}
