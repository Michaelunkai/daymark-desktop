import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env.DAYMARK_RUNTIME_EXECUTABLE_PATH
  ?? path.join(root, "release", "windows", "win-unpacked", "Daymark Runtime.exe");
const profilePath = path.join(root, "release", "windows", "evidence", "sync-profile");
const origin = "https://daymark-desktop.michaelovsky55555.chatgpt.site";
const localClientPath = process.env.DAYMARK_LOCAL_CLIENT_PATH
  ? path.resolve(process.env.DAYMARK_LOCAL_CLIENT_PATH)
  : null;
const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const windowsTitle = `Daymark Windows sync verification ${runId}`;
const remoteTitle = `Daymark remote sync verification ${runId}`;
const dateTransferTitle = `Daymark calendar transfer verification ${runId}`;
const orderDateTransfers = [
  { lane: "now", title: `Daymark Order Do now calendar verification ${runId}` },
  { lane: "later", title: `Daymark Order Later calendar verification ${runId}` },
  { lane: "after", title: `Daymark Order After calendar verification ${runId}` },
];
const today = new Date();
const moveDate = localDateAfter(today, 7);
const copyDate = localDateAfter(today, 8);
const calendarScreenshot = path.join(
  root,
  "release",
  "windows",
  "evidence",
  "task-date-transfer-calendar.png",
);
const compactCalendarScreenshot = path.join(
  root,
  "release",
  "windows",
  "evidence",
  "task-date-transfer-calendar-compact.png",
);

await mkdir(path.dirname(profilePath), { recursive: true });
await rm(profilePath, { recursive: true, force: true });

const desktop = await electron.launch({
  executablePath,
  args: ["--daymark-detached-child"],
  env: { ...process.env, DAYMARK_USER_DATA_DIR: profilePath },
  timeout: 60000,
});

if (localClientPath) {
  await desktop.context().route(`${origin}/**`, async (route) => {
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
  if (!response.ok) {
    const error = new Error(`Remote write failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

async function mutateRemote(key, mutate, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await readRemote(key);
    const nextState = structuredClone(current.state);
    const now = new Date().toISOString();
    mutate(nextState, now);
    nextState.revision = Number(current.revision) + 1;
    nextState.updatedAt = now;

    try {
      return await writeRemote(key, nextState, Number(current.revision));
    } catch (error) {
      if (error?.status !== 409 || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  throw new Error("Remote mutation exhausted its retry budget.");
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

let page = null;
try {
  page = await desktop.firstWindow({ timeout: 60000 });
  if (localClientPath) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  }
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

  const remoteTaskId = `windows-sync-${runId}`;
  await mutateRemote(key, (remoteState, now) => {
    const template = structuredClone(Object.values(remoteState.tasks)[0]);
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
  });
  await page.waitForFunction(
    (content) => Object.values(window.DaymarkAI?.getState?.().tasks ?? {}).some((task) => task.content === content),
    remoteTitle,
    { timeout: 60000 },
  );

  await mutateRemote(key, (cleanupState, now) => {
    delete cleanupState.tasks[remoteTaskId];
    cleanupState.syncTombstones = {
      ...(cleanupState.syncTombstones ?? {}),
      [`tasks:${remoteTaskId}`]: { deletedAt: now },
    };
  });
  await page.waitForFunction(
    (content) => !Object.values(window.DaymarkAI?.getState?.().tasks ?? {}).some((task) => task.content === content),
    remoteTitle,
    { timeout: 60000 },
  );

  const calendarCreate = await page.evaluate(({ content, date }) => window.DaymarkAI.dispatch({
    type: "task.add",
    input: {
      content,
      description: "Temporary visible calendar transfer verification record.",
      due: {
        date,
        time: "10:30",
        timezone: "Asia/Jerusalem",
        recurrence: null,
      },
    },
  }), { content: dateTransferTitle, date: localDateAfter(today, 1) });
  if (!calendarCreate?.ok) throw new Error("Calendar transfer task creation was rejected.");

  const createdTransferState = await pollRemote(
    key,
    (state) => Object.values(state.tasks ?? {}).some((task) => task.content === dateTransferTitle),
  );
  const createdTransferTask = Object.values(createdTransferState.state.tasks)
    .find((task) => task.content === dateTransferTitle);
  if (!createdTransferTask) throw new Error("Calendar transfer task was not synchronized.");

  await openTaskEditor(page, dateTransferTitle);
  await page.getByRole("button", { name: "Move to date", exact: true }).click();
  const calendar = page.locator(".task-editor__date-transfer .date-picker");
  await calendar.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(800);
  const calendarGeometry = await page.evaluate(() => {
    const picker = document.querySelector(".task-editor__date-transfer .date-picker");
    const content = document.querySelector(".task-editor__content");
    const surface = document.querySelector(".task-editor__surface");
    const footer = document.querySelector(".task-editor__footer");
    if (!picker || !content || !surface || !footer) return null;
    const pickerRect = picker.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      picker: pickerRect.toJSON(),
      content: contentRect.toJSON(),
      surface: surface.getBoundingClientRect().toJSON(),
      footer: footer.getBoundingClientRect().toJSON(),
    };
  });
  if (
    !calendarGeometry
    || calendarGeometry.picker.top < calendarGeometry.content.top - 2
    || calendarGeometry.picker.bottom > calendarGeometry.content.bottom + 2
  ) {
    throw new Error(`Date picker is not fully visible: ${JSON.stringify(calendarGeometry)}`);
  }
  if (await page.locator(".task-editor__form form").count()) {
    throw new Error("Date picker created an invalid nested form.");
  }
  if (await calendar.locator(".date-picker__day").count() !== 42) {
    throw new Error("Date picker did not render a complete six-week calendar.");
  }
  await page.screenshot({ path: calendarScreenshot, fullPage: false });
  await calendar.locator(`[data-date="${moveDate}"]`).click();
  await page.locator(".task-editor__surface").waitFor({ state: "detached", timeout: 10000 });
  await pollRemote(
    key,
    (state) => {
      const task = state.tasks?.[createdTransferTask.id];
      return task?.due?.date === moveDate && task?.due?.time === "10:30";
    },
  );

  await openTaskEditor(page, dateTransferTitle);
  await page.getByRole("button", { name: "Copy to date", exact: true }).click();
  await page.locator(".task-editor__date-transfer .date-picker").waitFor({
    state: "visible",
    timeout: 10000,
  });
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(640, 400);
    window.center();
  });
  await page.waitForTimeout(300);
  const compactLayout = await page.evaluate(() => {
    const content = document.querySelector(".task-editor__content");
    const surface = document.querySelector(".task-editor__surface");
    if (!content || !surface) return null;
    const surfaceRect = surface.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      surface: surfaceRect.toJSON(),
      documentHorizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      contentHorizontalOverflow: content.scrollWidth - content.clientWidth,
      contentScrollable: content.scrollHeight > content.clientHeight,
      contentScrollTop: content.scrollTop,
    };
  });
  if (
    !compactLayout
    || compactLayout.surface.left < -2
    || compactLayout.surface.right > compactLayout.viewport.width + 2
    || compactLayout.surface.top < -2
    || compactLayout.surface.bottom > compactLayout.viewport.height + 2
    || compactLayout.documentHorizontalOverflow > 2
    || compactLayout.contentHorizontalOverflow > 2
    || !compactLayout.contentScrollable
  ) {
    throw new Error(`Compact date picker is clipped or inaccessible: ${JSON.stringify(compactLayout)}`);
  }
  const compactContent = page.locator(".task-editor__content");
  const compactScrollStart = await compactContent.evaluate((element) => element.scrollTop);
  await compactContent.hover();
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(350);
  const compactScrollEnd = await compactContent.evaluate((element) => element.scrollTop);
  if (compactScrollEnd <= compactScrollStart) {
    throw new Error(`Mouse wheel did not scroll the compact date picker: ${JSON.stringify({
      compactScrollStart,
      compactScrollEnd,
    })}`);
  }
  const compactCopyDate = page.locator(
    `.task-editor__date-transfer [data-date="${copyDate}"]`,
  );
  await compactCopyDate.scrollIntoViewIfNeeded();
  await page.screenshot({ path: compactCalendarScreenshot, fullPage: false });
  await compactCopyDate.click();
  await page.locator(".task-editor__surface").waitFor({ state: "detached", timeout: 10000 });
  await pollRemote(
    key,
    (state) => {
      const matches = Object.values(state.tasks ?? {})
        .filter((task) => task.content === dateTransferTitle);
      return matches.length === 2
        && matches.some((task) => task.id === createdTransferTask.id && task.due?.date === moveDate)
        && matches.some((task) => task.id !== createdTransferTask.id && task.due?.date === copyDate)
        && matches.every((task) => task.due?.time === "10:30");
    },
  );

  const cleanupResults = await page.evaluate((content) => {
    const state = window.DaymarkAI.getState();
    return Object.values(state.tasks)
      .filter((task) => task.content === content)
      .map((task) => window.DaymarkAI.dispatch({ type: "task.delete", taskId: task.id }));
  }, dateTransferTitle);
  if (cleanupResults.some((result) => !result?.ok)) {
    throw new Error("Calendar transfer cleanup was rejected.");
  }
  await pollRemote(
    key,
    (state) => !Object.values(state.tasks ?? {}).some((task) => task.content === dateTransferTitle),
  );

  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1440, 960);
    window.center();
  });
  await page.waitForTimeout(300);

  const orderDateResults = [];
  for (let index = 0; index < orderDateTransfers.length; index += 1) {
    const transfer = orderDateTransfers[index];
    const orderCopyDate = localDateAfter(today, 10 + index * 2);
    const orderMoveDate = localDateAfter(today, 11 + index * 2);
    const orderCreate = await page.evaluate(({ title, lane }) => window.DaymarkAI.dispatch({
      type: "order.add",
      input: {
        title,
        details: `Temporary ${lane} Order calendar verification record.`,
        lane,
        relationId: null,
        priority: 4,
        status: "open",
      },
    }), transfer);
    if (!orderCreate?.ok) {
      throw new Error(`Order ${transfer.lane} verification item creation was rejected.`);
    }
    const createdOrderState = await pollRemote(
      key,
      (state) => Object.values(state.orderItems ?? {})
        .some((item) => item.title === transfer.title && item.lane === transfer.lane),
    );
    const createdOrderItem = Object.values(createdOrderState.state.orderItems)
      .find((item) => item.title === transfer.title && item.lane === transfer.lane);
    if (!createdOrderItem) {
      throw new Error(`Order ${transfer.lane} verification item was not synchronized.`);
    }

    await openOrderItemEditor(page, transfer.title);
    const orderEditor = page.locator(".order-editor");
    await orderEditor.getByRole("button", { name: "Copy to date", exact: true }).click();
    const copyCalendar = orderEditor.locator(".order-editor__calendar-transfer .date-picker");
    await copyCalendar.waitFor({ state: "visible", timeout: 10000 });
    if (await copyCalendar.locator(".date-picker__day").count() !== 42) {
      throw new Error(`Order ${transfer.lane} copy calendar is incomplete.`);
    }
    await copyCalendar.locator(`[data-date="${orderCopyDate}"]`).click();
    await orderEditor.waitFor({ state: "detached", timeout: 10000 });
    const orderCopyRemote = await pollRemote(
      key,
      (state) => {
        const source = state.orderItems?.[createdOrderItem.id];
        const copy = Object.values(state.tasks ?? {})
          .find((task) => task.content === transfer.title && task.due?.date === orderCopyDate);
        return source?.lane === transfer.lane
          && copy?.projectId === state.preferences.inboxProjectId
          && copy?.sectionId === null;
      },
    );
    const copiedTask = Object.values(orderCopyRemote.state.tasks)
      .find((task) => task.content === transfer.title && task.due?.date === orderCopyDate);
    if (!copiedTask) {
      throw new Error(`Order ${transfer.lane} calendar copy was not synchronized.`);
    }
    const copiedCleanup = await page.evaluate(
      (taskId) => window.DaymarkAI.dispatch({ type: "task.delete", taskId }),
      copiedTask.id,
    );
    if (!copiedCleanup?.ok) {
      throw new Error(`Order ${transfer.lane} calendar copy cleanup was rejected.`);
    }
    await pollRemote(key, (state) => !state.tasks?.[copiedTask.id]);

    await openOrderItemEditor(page, transfer.title);
    await page.locator(".order-editor")
      .getByRole("button", { name: "Move to date", exact: true })
      .click();
    const moveCalendar = page.locator(
      ".order-editor__calendar-transfer .date-picker",
    );
    await moveCalendar.waitFor({ state: "visible", timeout: 10000 });
    await moveCalendar.locator(`[data-date="${orderMoveDate}"]`).click();
    await page.locator(".order-editor").waitFor({ state: "detached", timeout: 10000 });
    const orderMoveRemote = await pollRemote(
      key,
      (state) => {
        const movedTask = Object.values(state.tasks ?? {})
          .find((task) => task.content === transfer.title && task.due?.date === orderMoveDate);
        return !state.orderItems?.[createdOrderItem.id]
          && movedTask?.projectId === state.preferences.inboxProjectId
          && movedTask?.sectionId === null;
      },
    );
    const movedTask = Object.values(orderMoveRemote.state.tasks)
      .find((task) => task.content === transfer.title && task.due?.date === orderMoveDate);
    if (!movedTask) {
      throw new Error(`Order ${transfer.lane} calendar move was not synchronized.`);
    }
    const movedCleanup = await page.evaluate(
      (taskId) => window.DaymarkAI.dispatch({ type: "task.delete", taskId }),
      movedTask.id,
    );
    if (!movedCleanup?.ok) {
      throw new Error(`Order ${transfer.lane} calendar move cleanup was rejected.`);
    }
    await pollRemote(key, (state) => !state.tasks?.[movedTask.id]);
    orderDateResults.push({
      lane: transfer.lane,
      copyDate: orderCopyDate,
      moveDate: orderMoveDate,
      copyRetainedSource: true,
      moveRemovedSource: true,
    });
  }

  const final = await readRemote(key);
  const finalCounts = {
    projects: Object.keys(final.state.projects ?? {}).length,
    tasks: Object.keys(final.state.tasks ?? {}).length,
    orderItems: Object.keys(final.state.orderItems ?? {}).length,
  };
  const temporaryRecordsRemaining = Object.values(final.state.tasks ?? {})
    .filter((task) =>
      task.content === windowsTitle
      || task.content === remoteTitle
      || task.content === dateTransferTitle
      || orderDateTransfers.some((transfer) => task.content === transfer.title)
    ).length;
  const temporaryOrderRecordsRemaining = Object.values(final.state.orderItems ?? {})
    .filter((item) => orderDateTransfers.some((transfer) => item.title === transfer.title))
    .length;
  if (temporaryRecordsRemaining || temporaryOrderRecordsRemaining) {
    throw new Error(`Temporary verification records remain: ${JSON.stringify({
      temporaryRecordsRemaining,
      temporaryOrderRecordsRemaining,
    })}`);
  }
  const countsPreserved = JSON.stringify(finalCounts) === JSON.stringify(baselineCounts);
  const concurrentWorkspaceDelta = {
    projects: finalCounts.projects - baselineCounts.projects,
    tasks: finalCounts.tasks - baselineCounts.tasks,
    orderItems: finalCounts.orderItems - baselineCounts.orderItems,
  };
  console.log(JSON.stringify({
    ok: true,
    windowsToRemote: true,
    remoteToWindows: true,
    calendarMoveToDate: true,
    calendarCopyToDate: true,
    calendarMoveDate: moveDate,
    calendarCopyDate: copyDate,
    calendarPreservedTime: "10:30",
    calendarScreenshot,
    compactCalendarScreenshot,
    compactCalendarMouseScroll: true,
    compactCalendarLayout: compactLayout,
    orderCalendarTransfers: orderDateResults,
    localClientPath,
    baselineRevision: baseline.revision,
    finalRevision: final.revision,
    baselineCounts,
    finalCounts,
    countsPreserved,
    concurrentWorkspaceDelta,
    temporaryRecordsRemaining,
    temporaryOrderRecordsRemaining,
  }));
} finally {
  if (page) {
    await page.evaluate(({ taskTitles, orderTitles }) => {
      const state = window.DaymarkAI?.getState?.();
      if (!state) return [];
      const taskResults = Object.values(state.tasks)
        .filter((task) => taskTitles.includes(task.content))
        .map((task) => window.DaymarkAI.dispatch({ type: "task.delete", taskId: task.id }));
      const orderResults = Object.values(state.orderItems)
        .filter((item) => orderTitles.includes(item.title))
        .map((item) => window.DaymarkAI.dispatch({ type: "order.remove", itemId: item.id }));
      return [...taskResults, ...orderResults];
    }, {
      taskTitles: [
        windowsTitle,
        remoteTitle,
        dateTransferTitle,
        ...orderDateTransfers.map((transfer) => transfer.title),
      ],
      orderTitles: orderDateTransfers.map((transfer) => transfer.title),
    }).catch(() => []);
    await page.waitForTimeout(1500).catch(() => {});
  }
  await desktop.close();
}

async function openTaskEditor(page, title) {
  await page.getByRole("button", { name: /^Upcoming/ }).first().click();
  const search = page.locator('input[placeholder="Search your workspace"]');
  await search.fill(title);
  const taskButton = page.getByRole("button", { name: title, exact: true }).first();
  await taskButton.waitFor({ state: "visible", timeout: 10000 });
  await taskButton.click();
  await page.locator(".task-editor__surface").waitFor({ state: "visible", timeout: 10000 });
}

async function openOrderItemEditor(page, title) {
  const orderButton = page.getByRole("button", { name: /^Order/ }).first();
  if (await orderButton.getAttribute("aria-current") !== "page") {
    await orderButton.click();
  }
  const itemButton = page.getByRole("button", { name: title, exact: true }).first();
  await itemButton.waitFor({ state: "visible", timeout: 10000 });
  await itemButton.click();
  await page.locator(".order-editor").waitFor({ state: "visible", timeout: 10000 });
}

function localDateAfter(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, "0"),
    String(next.getDate()).padStart(2, "0"),
  ].join("-");
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".ico") return "image/x-icon";
  return "application/octet-stream";
}
