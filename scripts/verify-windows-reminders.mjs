import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env.DAYMARK_RUNTIME_EXECUTABLE_PATH
  ?? path.join(root, "release", "windows", "win-unpacked", "Daymark Runtime.exe");
const evidenceDirectory = path.join(root, "release", "windows", "evidence");
const profilePath = path.join(evidenceDirectory, "reminder-profile");
const schedulePath = path.join(profilePath, "reminder-schedules.json");
const resourcesDirectory = path.join(
  root,
  "release",
  "windows",
  "win-unpacked",
  "resources",
  "assets",
);
const now = Date.now();
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

await mkdir(evidenceDirectory, { recursive: true });
await rm(profilePath, { recursive: true, force: true });

const desktop = await electron.launch({
  executablePath,
  args: ["--daymark-detached-child"],
  env: { ...process.env, DAYMARK_USER_DATA_DIR: profilePath },
  timeout: 60_000,
});

try {
  const page = await desktop.firstWindow({ timeout: 60_000 });
  await page.waitForFunction(
    () => typeof window.DaymarkDesktop?.syncReminders === "function",
    null,
    { timeout: 60_000 },
  );
  await page.evaluate((schedules) => {
    window.DaymarkDesktop.syncReminders(JSON.stringify(schedules));
  }, [schedule]);

  await page.waitForTimeout(300);
  const saved = JSON.parse(await readFile(schedulePath, "utf8"));
  if (
    !Array.isArray(saved)
    || saved.length !== 1
    || saved[0]?.id !== schedule.id
    || saved[0]?.alertAt !== schedule.alertAt
  ) {
    throw new Error(`The native reminder schedule was not persisted: ${JSON.stringify(saved)}`);
  }

  for (const sound of ["soft", "alert", "alarm"]) {
    await access(path.join(resourcesDirectory, `daymark_reminder_${sound}.wav`));
  }

  console.log(JSON.stringify({
    ok: true,
    executablePath,
    scheduleId: schedule.id,
    persistedSchedules: saved.length,
    resourcesDirectory,
  }));
} finally {
  await desktop.close();
}
