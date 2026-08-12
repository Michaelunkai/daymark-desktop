import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = path.join(root, "release", "windows", "win-unpacked", "Daymark.exe");
const evidenceDirectory = path.join(root, "release", "windows", "evidence");
const userDataDirectory = path.join(evidenceDirectory, "runtime-profile");
const screenshotPath = path.join(evidenceDirectory, "daymark-windows-runtime.png");
const launchArgs = [];

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
    const raw = localStorage.getItem("todoist-replica.state");
    if (!raw) return false;
    const state = JSON.parse(raw);
    return Number(state.revision ?? 0) >= 1800
      && Object.keys(state.projects ?? {}).length >= 8
      && Object.keys(state.tasks ?? {}).length >= 170;
  }, null, { timeout: 60000 });

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
  if (runtime.revision < 1800 || runtime.projectCount < 8 || runtime.taskCount < 170 || runtime.readyTextLength < 100) {
    throw new Error(`The Windows runtime did not render the synchronized Daymark workspace: ${JSON.stringify(redactedRuntime)}`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    executablePath,
    screenshotPath,
    runtime: redactedRuntime,
  }));
} finally {
  await desktop.close();
}
