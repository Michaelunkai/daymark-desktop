import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env.DAYMARK_RUNTIME_EXECUTABLE_PATH
  ?? path.join(root, "release", "windows", "win-unpacked", "Daymark Runtime.exe");
const evidenceDirectory = path.join(root, "release", "windows", "evidence");
const userDataDirectory = path.join(evidenceDirectory, "runtime-profile");
const screenshotPath = path.join(evidenceDirectory, "daymark-windows-runtime.png");
const launchArgs = ["--daymark-detached-child"];
const productionOrigin = "https://daymark-desktop.michaelovsky55555.chatgpt.site";

await mkdir(evidenceDirectory, { recursive: true });
await rm(userDataDirectory, { recursive: true, force: true });

const desktop = await electron.launch({
  executablePath,
  args: launchArgs,
  env: { ...process.env, DAYMARK_USER_DATA_DIR: userDataDirectory },
  timeout: 60000,
});

try {
  const page = await desktop.firstWindow({ timeout: 60000 });
  await page.waitForURL(
    /daymark-desktop\.michaelovsky55555\.chatgpt\.site/,
    { timeout: 60000 },
  );
  await page.locator("#root").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => {
    const root = document.querySelector("#root");
    return root && root.children.length > 0 && (root.textContent ?? "").trim().length > 0;
  }, null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const root = document.querySelector("#root");
    return root?.getAttribute("data-daymark-ready") === "true"
      && /^[A-Za-z0-9_-]{22}$/.test(localStorage.getItem("daymark.sync-key") ?? "");
  }, null, { timeout: 60000 });
  const syncKey = await page.evaluate(() => localStorage.getItem("daymark.sync-key"));
  const remoteResponse = await fetch(
    `${productionOrigin}/api/sync/${encodeURIComponent(syncKey)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!remoteResponse.ok) {
    throw new Error(`The canonical Daymark workspace could not be read (${remoteResponse.status}).`);
  }
  const remotePayload = await remoteResponse.json();
  const expectedRemoteRevision = Number(remotePayload.revision ?? remotePayload.state?.revision ?? 0);
  if (!Number.isInteger(expectedRemoteRevision) || expectedRemoteRevision < 1) {
    throw new Error("The canonical Daymark workspace returned an invalid revision.");
  }
  await page.waitForFunction((expectedRevision) => {
    const raw = localStorage.getItem("todoist-replica.state");
    if (!raw) return false;
    const state = JSON.parse(raw);
    return Number(state.revision ?? 0) >= expectedRevision
      && Object.keys(state.projects ?? {}).length >= 1
      && Object.keys(state.tasks ?? {}).length >= 1;
  }, expectedRemoteRevision, { timeout: 60000 });

  const runtime = await page.evaluate(() => {
    const raw = localStorage.getItem("todoist-replica.state");
    const state = raw ? JSON.parse(raw) : null;
    return {
      title: document.title,
      url: location.href,
      syncKey: localStorage.getItem("daymark.sync-key"),
      revision: state?.revision ?? null,
      projectCount: state ? Object.keys(state.projects ?? {}).length : 0,
      taskCount: state ? Object.keys(state.tasks ?? {}).length : 0,
      orderCount: state ? Object.keys(state.orderItems ?? {}).length : 0,
      readyTextLength: (document.querySelector("#root")?.textContent ?? "").trim().length,
    };
  });
  const redactedRuntime = { ...runtime, syncKey: "[redacted]" };

  if (!/^[A-Za-z0-9_-]{22}$/.test(runtime.syncKey ?? "")) {
    throw new Error(`The Windows runtime did not persist a valid Daymark pairing key: ${JSON.stringify(redactedRuntime)}`);
  }
  if (!Number.isInteger(runtime.revision) || runtime.revision < 1) {
    throw new Error(`The Windows runtime did not load a synchronized workspace revision: ${JSON.stringify(redactedRuntime)}`);
  }
  if (
    runtime.revision < expectedRemoteRevision
    || runtime.projectCount < 1
    || runtime.taskCount < 1
    || runtime.readyTextLength < 100
  ) {
    throw new Error(`The Windows runtime did not render the synchronized Daymark workspace: ${JSON.stringify(redactedRuntime)}`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    executablePath,
    screenshotPath,
    expectedRemoteRevision,
    runtime: redactedRuntime,
  }));
} finally {
  await desktop.close();
}
