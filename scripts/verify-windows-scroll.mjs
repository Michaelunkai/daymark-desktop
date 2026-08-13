import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = path.join(root, "release", "windows", "win-unpacked", "Daymark.exe");
const evidenceDirectory = path.join(root, "release", "windows", "evidence");
const profilePath = path.join(evidenceDirectory, "scroll-profile");
const wheelDelta = 420;
const sampleDelays = [0, 16, 32, 64, 120, 240, 500];
const fixedRoutes = ["today", "inbox", "upcoming", "completed", "order", "notes", "diary"];

await mkdir(evidenceDirectory, { recursive: true });
await rm(profilePath, { recursive: true, force: true });

const desktop = await electron.launch({
  executablePath,
  env: { ...process.env, DAYMARK_USER_DATA_DIR: profilePath },
  timeout: 60000,
});

function summarizeState(state) {
  return {
    revision: Number(state?.revision ?? 0),
    projectIds: Object.keys(state?.projects ?? {}).sort(),
    taskIds: Object.keys(state?.tasks ?? {}).sort(),
    orderItemIds: Object.keys(state?.orderItems ?? {}).sort(),
  };
}

async function sampleScroll(page, selector) {
  const samples = [];
  let elapsed = 0;
  for (const delay of sampleDelays) {
    await page.waitForTimeout(delay - elapsed);
    elapsed = delay;
    samples.push(await page.locator(selector).evaluate((element) => ({
      active: element.classList.contains("daymark-smooth-wheel-active"),
      x: element.scrollLeft,
      y: element.scrollTop,
    })));
  }
  return samples;
}

async function findPrimaryScrollTarget(page) {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll(".main-content, .main-content *")]
      .filter((candidate) => candidate instanceof HTMLElement)
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          element,
          maxY: Math.max(0, element.scrollHeight - element.clientHeight),
          overflowY: style.overflowY,
          rect,
        };
      })
      .filter(({ maxY, overflowY, rect }) =>
        maxY > 1
        && /^(auto|scroll|overlay)$/.test(overflowY)
        && rect.width > 40
        && rect.height > 40
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < innerHeight
        && rect.left < innerWidth,
      )
      .sort((a, b) => b.maxY - a.maxY);

    document.querySelectorAll("[data-daymark-scroll-test]").forEach((element) => {
      element.removeAttribute("data-daymark-scroll-test");
    });
    const target = candidates[0];
    if (!target) return null;
    const sidebar = document.querySelector(".sidebar__scroll");
    const sidebarCanScroll = sidebar instanceof HTMLElement
      && sidebar.scrollHeight - sidebar.clientHeight > 1;
    if (target.element.matches(".main-content") && target.maxY <= 320 && sidebarCanScroll) {
      return null;
    }
    target.element.setAttribute("data-daymark-scroll-test", "primary");
    target.element.classList.add("daymark-smooth-wheel-active");
    target.element.scrollTop = 0;
    target.element.classList.remove("daymark-smooth-wheel-active");
    const rect = target.element.getBoundingClientRect();
    return {
      selector: '[data-daymark-scroll-test="primary"]',
      maxY: target.maxY,
      x: Math.max(1, Math.min(innerWidth - 1, rect.left + (rect.width / 2))),
      y: Math.max(1, Math.min(innerHeight - 1, rect.top + (rect.height / 2))),
    };
  });
}

function distinctPositions(samples) {
  return new Set(samples.map((sample) => Math.round(sample.y * 10) / 10)).size;
}

async function verifyShellViewportBounds(page) {
  const result = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const grid = document.querySelector(".shell-grid");
    const sidebar = document.querySelector(".sidebar");
    const sidebarScroll = document.querySelector(".sidebar__scroll");
    const main = document.querySelector(".main-content");
    const elements = { shell, grid, sidebar, sidebarScroll, main };
    if (Object.values(elements).some((element) => !(element instanceof HTMLElement))) {
      return { ok: false, error: "Required shell elements are missing." };
    }

    const tolerance = 2;
    const viewport = { top: 0, left: 0, right: innerWidth, bottom: innerHeight };
    const rects = Object.fromEntries(
      Object.entries(elements).map(([name, element]) => [name, element.getBoundingClientRect().toJSON()]),
    );
    const escaped = Object.entries(rects)
      .filter(([, rect]) =>
        rect.top < viewport.top - tolerance
        || rect.left < viewport.left - tolerance
        || rect.right > viewport.right + tolerance
        || rect.bottom > viewport.bottom + tolerance,
      )
      .map(([name]) => name);

    return {
      ok: escaped.length === 0,
      viewport: { width: innerWidth, height: innerHeight },
      escaped,
      rects,
    };
  });

  if (!result.ok) {
    throw new Error(`The desktop shell extends outside the visible viewport: ${JSON.stringify(result)}`);
  }
  return result;
}

async function verifyRoute(page, route, label) {
  const navigation = await page.evaluate((nextRoute) => window.DaymarkAI.navigate(nextRoute), route);
  if (!navigation?.ok) throw new Error(`Navigation was rejected for ${label}: ${JSON.stringify(navigation)}`);
  await page.waitForFunction(
    (nextRoute) => window.DaymarkAI?.getViewState?.().route === nextRoute,
    route,
    { timeout: 10000 },
  );
  await page.waitForTimeout(180);

  const target = await findPrimaryScrollTarget(page);
  if (!target) return { route, label, scrollable: false };

  await page.mouse.move(target.x, target.y);
  await page.mouse.wheel(0, wheelDelta);
  const down = await sampleScroll(page, target.selector);
  const downEnd = down.at(-1);
  if (downEnd.y <= 1 || distinctPositions(down) < 2 || downEnd.active) {
    throw new Error(`Mouse-wheel down scrolling failed for ${label}: ${JSON.stringify({ target, down })}`);
  }

  await page.mouse.wheel(0, -wheelDelta);
  const up = await sampleScroll(page, target.selector);
  const upEnd = up.at(-1);
  if (upEnd.y >= downEnd.y - 1 || distinctPositions(up) < 2 || upEnd.active || upEnd.y > 2) {
    throw new Error(`Mouse-wheel up scrolling failed for ${label}: ${JSON.stringify({ target, down, up })}`);
  }

  return {
    route,
    label,
    scrollable: true,
    maxY: Math.round(target.maxY),
    downFrames: distinctPositions(down),
    downEnd: Math.round(downEnd.y * 10) / 10,
    upFrames: distinctPositions(up),
    upEnd: Math.round(upEnd.y * 10) / 10,
  };
}

async function verifyBlankWorkspaceRoutesWheelToProjects(page) {
  const route = "today";
  const navigation = await page.evaluate((nextRoute) => window.DaymarkAI.navigate(nextRoute), route);
  if (!navigation?.ok) throw new Error("Navigation was rejected for the blank Today workspace.");
  await page.waitForFunction(
    (nextRoute) => window.DaymarkAI?.getViewState?.().route === nextRoute,
    route,
    { timeout: 10000 },
  );
  await page.waitForTimeout(180);

  const geometry = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar__scroll");
    const main = document.querySelector(".main-content");
    if (!(sidebar instanceof HTMLElement) || !(main instanceof HTMLElement)) return null;
    let fixture = sidebar.querySelector('[data-daymark-scroll-fixture="projects-overflow"]');
    if (!(fixture instanceof HTMLElement) && sidebar.scrollHeight <= sidebar.clientHeight) {
      fixture = document.createElement("div");
      fixture.setAttribute("data-daymark-scroll-fixture", "projects-overflow");
      fixture.setAttribute("aria-hidden", "true");
      fixture.style.height = "1200px";
      fixture.style.minHeight = "1200px";
      fixture.style.pointerEvents = "none";
      sidebar.append(fixture);
    }
    sidebar.classList.add("daymark-smooth-wheel-active");
    sidebar.scrollTop = 0;
    sidebar.classList.remove("daymark-smooth-wheel-active");
    const sidebarRect = sidebar.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const sidebarStyle = getComputedStyle(sidebar);
    const thumbHeight = Math.max(52, sidebar.clientHeight * (sidebar.clientHeight / sidebar.scrollHeight));
    return {
      maxSidebarY: Math.max(0, sidebar.scrollHeight - sidebar.clientHeight),
      mainMaxY: Math.max(0, main.scrollHeight - main.clientHeight),
      x: Math.max(1, Math.min(innerWidth - 1, mainRect.left + (mainRect.width * 0.75))),
      y: Math.max(1, Math.min(innerHeight - 1, mainRect.top + (mainRect.height * 0.5))),
      scrollbarColor: sidebarStyle.scrollbarColor,
      scrollbarWidth: sidebarStyle.scrollbarWidth,
      scrollbarX: sidebarRect.right - 6,
      thumbStartY: sidebarRect.top + (thumbHeight / 2),
      thumbDragY: Math.min(sidebarRect.bottom - (thumbHeight / 2), sidebarRect.top + (thumbHeight / 2) + 180),
      fixtureAdded: Boolean(fixture),
    };
  });
  if (
    !geometry
    || geometry.maxSidebarY <= 1
    || geometry.mainMaxY > 320
    || geometry.scrollbarColor === "auto"
    || geometry.scrollbarWidth === "none"
  ) {
    throw new Error(`The screenshot regression layout was not reproduced: ${JSON.stringify(geometry)}`);
  }

  await page.mouse.move(geometry.x, geometry.y);
  await page.mouse.wheel(0, wheelDelta);
  const down = await sampleScroll(page, ".sidebar__scroll");
  const downEnd = down.at(-1);
  if (downEnd.y <= 1 || distinctPositions(down) < 3 || downEnd.active) {
    throw new Error(`Blank-workspace wheel did not scroll the Projects navigation down: ${JSON.stringify({ geometry, down })}`);
  }

  await page.mouse.wheel(0, -wheelDelta);
  const up = await sampleScroll(page, ".sidebar__scroll");
  const upEnd = up.at(-1);
  if (upEnd.y > 2 || distinctPositions(up) < 3 || upEnd.active) {
    throw new Error(`Blank-workspace wheel did not scroll the Projects navigation back up: ${JSON.stringify({ geometry, down, up })}`);
  }

  await page.mouse.move(geometry.scrollbarX, geometry.thumbStartY);
  await page.mouse.down();
  await page.mouse.move(geometry.scrollbarX, geometry.thumbDragY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const draggedY = await page.locator(".sidebar__scroll").evaluate((element) => element.scrollTop);
  if (draggedY <= 1) {
    throw new Error(`The visible Projects scrollbar could not be dragged: ${JSON.stringify({ geometry, draggedY })}`);
  }
  await page.evaluate(() => {
    document.querySelector('[data-daymark-scroll-fixture="projects-overflow"]')?.remove();
  });

  return {
    route,
    view: "Today",
    pointerRegion: "blank main workspace",
    sidebarMaxY: Math.round(geometry.maxSidebarY),
    downFrames: distinctPositions(down),
    downEnd: Math.round(downEnd.y * 10) / 10,
    upFrames: distinctPositions(up),
    upEnd: Math.round(upEnd.y * 10) / 10,
    scrollbarDraggedTo: Math.round(draggedY * 10) / 10,
  };
}

try {
  const page = await desktop.firstWindow({ timeout: 60000 });
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1000, 650);
    window.center();
  });
  await page.waitForURL(/daymark-desktop\.michaelovsky55555\.chatgpt\.site/, { timeout: 60000 });
  await page.waitForFunction(() => {
    const state = window.DaymarkAI?.getState?.();
    return Number(state?.revision ?? 0) >= 1800
      && Object.keys(state?.projects ?? {}).length >= 8
      && Object.keys(state?.tasks ?? {}).length >= 170;
  }, null, { timeout: 60000 });

  const baselineState = await page.evaluate(() => window.DaymarkAI.getState());
  const baseline = summarizeState(baselineState);
  const shellViewport = await verifyShellViewportBounds(page);
  const projects = Object.values(baselineState.projects ?? {})
    .map((project) => ({
      id: project.id,
      name: project.name ?? project.title ?? project.id,
      pendingTasks: Object.values(baselineState.tasks ?? {})
        .filter((task) => task.projectId === project.id && !task.completedAt).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const routes = [
    ...fixedRoutes.map((route) => ({ route, label: route })),
    ...projects.map((project) => ({
      route: `project:${project.id}`,
      label: `project ${project.name}`,
    })),
  ];

  const results = [];
  for (const route of routes) results.push(await verifyRoute(page, route.route, route.label));
  const blankWorkspaceSidebar = await verifyBlankWorkspaceRoutesWheelToProjects(page);

  const final = summarizeState(await page.evaluate(() => window.DaymarkAI.getState()));
  if (JSON.stringify(final) !== JSON.stringify(baseline)) {
    throw new Error(`Scroll verification changed synchronized workspace data: ${JSON.stringify({ baseline, final })}`);
  }

  const scrollable = results.filter((result) => result.scrollable);
  const scrollableProjects = scrollable.filter((result) => result.route.startsWith("project:"));
  if (scrollable.length < 3 || scrollableProjects.length < 2) {
    throw new Error(`Too few rendered views were scrollable to prove broad wheel support: ${JSON.stringify(results)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    executablePath,
    baseline: {
      revision: baseline.revision,
      projects: baseline.projectIds.length,
      tasks: baseline.taskIds.length,
      orderItems: baseline.orderItemIds.length,
    },
    shellViewport,
    routesChecked: results.length,
    scrollableRoutes: scrollable.length,
    scrollableProjects: scrollableProjects.length,
    blankWorkspaceSidebar,
    results,
  }));
} finally {
  await desktop.close();
}
