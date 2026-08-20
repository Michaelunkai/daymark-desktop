import { access, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env.DAYMARK_RUNTIME_EXECUTABLE_PATH
  ?? path.join(root, "release", "windows", "win-unpacked", "Daymark Runtime.exe");
const evidenceDirectory = path.join(root, "release", "windows", "evidence");
const productionOrigin = "https://daymark-desktop.michaelovsky55555.chatgpt.site";
const localClientPath = process.env.DAYMARK_LOCAL_CLIENT_PATH
  ? path.resolve(process.env.DAYMARK_LOCAL_CLIENT_PATH)
  : null;
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const isolatedRoot = process.env.DAYMARK_REMINDER_VERIFY_ROOT
  ? path.resolve(process.env.DAYMARK_REMINDER_VERIFY_ROOT)
  : path.join(evidenceDirectory, `reminder-${runId}`);
const profilePath = path.join(isolatedRoot, "profile");
const schedulePath = path.join(profilePath, "reminder-schedules.json");
const deliveredPath = path.join(profilePath, "reminder-delivered.json");
const resourcesDirectory = path.join(
  root,
  "release",
  "windows",
  "win-unpacked",
  "resources",
  "assets",
);
const now = Date.now();
const exerciseDelivery = process.env.DAYMARK_VERIFY_FIRE === "1";
const schedule = {
  id: `verification-reminder-${now}`,
  title: "Daymark native reminder verification",
  details: "Temporary isolated scheduler verification.",
  eventAt: now + 20 * 60_000,
  alertAt: now + 10 * 60_000,
  minutes: 10,
  direction: "before",
  ordinal: 1,
  total: 1,
  sound: "alert",
};

await mkdir(isolatedRoot, { recursive: true });

const desktop = await electron.launch({
  executablePath,
  args: ["--daymark-detached-child"],
  env: {
    ...process.env,
    DAYMARK_USER_DATA_DIR: profilePath,
    DAYMARK_ACCEPTANCE_EVENTS: "1",
    DAYMARK_STARTUP_TRACE: "1",
    DAYMARK_VERIFY_EXIT: "1",
  },
  timeout: 60_000,
});

if (localClientPath) {
  await desktop.context().route(`${productionOrigin}/**`, async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    const relativePath = decodeURIComponent(requestUrl.pathname)
      .replace(/^\/+/, "")
      .replace(/\\/g, "/");
    if (relativePath.split("/").includes("..")) {
      await route.abort();
      return;
    }

    let filePath = path.join(localClientPath, relativePath || "index.html");
    try {
      await access(filePath);
    } catch {
      filePath = path.join(localClientPath, "index.html");
    }
    await route.fulfill({
      status: 200,
      contentType: contentTypeFor(filePath),
      body: await readFile(filePath),
    });
  });
}

try {
  const page = await desktop.firstWindow({ timeout: 60_000 });
  if (localClientPath) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  await page.waitForFunction(
    () => window.DaymarkDesktop?.getReminderStatus?.() === "desktop-ready"
      && typeof window.DaymarkDesktop?.syncReminders === "function"
      && typeof window.DaymarkAI?.getState === "function",
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(2_000);
  const version = await page.evaluate(() => window.DaymarkDesktop.getDesktopVersion?.());
  if (version !== "1.4.44") {
    throw new Error(`Unexpected desktop version: ${version}`);
  }

  await page.evaluate((sounds) => {
    for (const sound of sounds) window.DaymarkDesktop.testReminderSound?.(sound);
  }, ["soft", "alert", "alarm"]);

  const schedules = exerciseDelivery
    ? [
      schedule,
      {
        ...schedule,
        id: `${schedule.id}:fire`,
        title: "Daymark native reminder delivery verification",
        alertAt: Date.now() + 250,
        eventAt: Date.now() + 60_000,
        minutes: 0,
      },
    ]
    : [schedule];
  const persistence = await page.evaluate((schedules) => (
    window.DaymarkDesktop.syncReminders(JSON.stringify(schedules))
  ), schedules);
  if (!persistence?.ok || !persistence.persisted) {
    throw new Error(`The native reminder schedule was not acknowledged: ${JSON.stringify(persistence)}`);
  }

  await page.waitForTimeout(300);
  const saved = JSON.parse(await readFile(schedulePath, "utf8"));
  const savedBaseSchedule = saved.find((item) => item.id === schedule.id);
  if (
    !Array.isArray(saved)
    || !savedBaseSchedule
    || savedBaseSchedule.alertAt !== schedule.alertAt
    || (!exerciseDelivery && saved.length !== schedules.length)
  ) {
    throw new Error(`The native reminder schedule was not persisted: ${JSON.stringify(saved)}`);
  }

  if (exerciseDelivery) {
    const fireId = schedules[1].id;
    await page.waitForFunction(async (expectedId) => {
      const diagnostics = await window.DaymarkDesktop.getDesktopDiagnostics?.();
      return diagnostics?.deliveredReminderIds?.includes(expectedId) ?? false;
    }, fireId, { timeout: 60_000 });
    const delivered = JSON.parse(await readFile(deliveredPath, "utf8"));
    const remaining = JSON.parse(await readFile(schedulePath, "utf8"));
    if (!delivered.includes(fireId) || remaining.some((item) => item.id === fireId)) {
      throw new Error(`Delivery was not durably acknowledged: ${JSON.stringify({ delivered, remaining })}`);
    }
  }

  for (const sound of ["soft", "alert", "alarm"]) {
    await access(path.join(resourcesDirectory, `daymark_reminder_${sound}.wav`));
  }

  const diagnostics = await page.evaluate(
    () => window.DaymarkDesktop.getDesktopDiagnostics?.(),
  );
  if (!diagnostics || diagnostics.version !== "1.4.44") {
    throw new Error(`Desktop diagnostics were unavailable: ${JSON.stringify(diagnostics)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    version,
    executablePath,
    isolatedRoot,
    scheduleId: schedule.id,
    persistedSchedules: saved.length,
    deliveredLedgerPath: deliveredPath,
    deliveredReminderCount: diagnostics.deliveredReminderCount,
    localClientPath,
    acceptanceEvents: diagnostics.startupEvents?.length ?? 0,
    resourcesDirectory,
  }));
} finally {
  await desktop.close();
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css",
    ".html": "text/html",
    ".ico": "image/x-icon",
    ".js": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }[extension] ?? "application/octet-stream";
}
