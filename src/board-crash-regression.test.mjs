import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const LIVE_STATE = (() => {
  const now = new Date().toISOString();
  const projId = "project-mva1csg8-ddkhi1uc";
  const mkTask = (id, content, sectionId, description) => ({
    id, content, description, projectId: projId, sectionId, parentId: null,
    priority: 2, due: null, completedAt: null, completionContext: null,
    order: 0, createdAt: now, updatedAt: now,
  });
  return {
    projId,
    sections: {
      "section-0304ba734937c17cea7a0976": { id: "section-0304ba734937c17cea7a0976", projectId: projId, name: "Finished", order: 0, isCollapsed: false, createdAt: now, updatedAt: now },
      "section-4f2fd8aad515ea7a578a48a3": { id: "section-4f2fd8aad515ea7a578a48a3", projectId: projId, name: "In Progress", order: 1, isCollapsed: false, createdAt: now, updatedAt: now },
      "section-mva1csi2-0od55qg8": { id: "section-mva1csi2-0od55qg8", projectId: projId, name: "To do", order: 2, isCollapsed: false, createdAt: now, updatedAt: now },
    },
    tasks: [
      mkTask("tsk-a28b2dbc", "ccz", "section-mva1csi2-0od55qg8", "\u2014 pinned \u2014\n\u2014 update 09:15 \u2014 bootstrap done\n\u2014 agents 2 \u2014\nsome detail line"),
      mkTask("task-mvghnkz6", "mark", "section-4f2fd8aad515ea7a578a48a3", "\u2014 update 10:00 \u2014 running\nlong description without markers"),
      mkTask("tsk-2dc89af9", "control", "section-4f2fd8aad515ea7a578a48a3", "plain description"),
      mkTask("task-mvghhavl", "myres", "section-mva1csi2-0od55qg8", ""),
      mkTask("task-mvfs3y5s", "Ins", "section-0304ba734937c17cea7a0976", "done thing"),
    ],
  };
})();

async function renderRoute(route, viewMode) {
  const dir = mkdtempSync(path.join(tmpdir(), "daymark-board-crash-"));
  let appPath = null;
  try {
    const appSource = readFileSync(path.join(root, "src", "App.jsx"), "utf8");
    const patched = appSource
      .replace("const [route, setRoute] = useState('order')", "const [route, setRoute] = useState(globalThis.__DAYMARK_ROUTE__ ?? 'order')")
      .replace("const [viewMode, setViewMode] = useState('list')", "const [viewMode, setViewMode] = useState(globalThis.__DAYMARK_VIEW__ ?? 'list')");
    assert.notEqual(patched, appSource, "route/viewMode hooks not found - update the repro patch");
    appPath = path.join(root, "src", ".AppRepro-" + path.basename(dir) + ".jsx");
    writeFileSync(appPath, patched);

    const entry = [
      "const store = new Map()",
      "globalThis.window = {",
      "  localStorage: {",
      "    getItem: (k) => (store.has(k) ? store.get(k) : null),",
      "    setItem: (k, v) => store.set(k, String(v)),",
      "    removeItem: (k) => store.delete(k),",
      "  },",
      "  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),",
      "  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},",
      "  requestAnimationFrame: (cb) => setTimeout(cb, 0),",
      "  location: { reload: () => {}, search: '' },",
      "  addEventListener: () => {}, removeEventListener: () => {},",
      "  DaymarkAndroid: null, DaymarkDesktop: null,",
      "}",
      "globalThis.localStorage = globalThis.window.localStorage",
      "globalThis.document = {",
      "  visibilityState: 'visible',",
      "  addEventListener: () => {}, removeEventListener: () => {},",
      "  cookie: '',",
      "  createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, remove: () => {} }),",
      "  documentElement: { setAttribute: () => {} },",
      "  getElementById: () => null,",
      "  body: { appendChild: () => {} },",
      "}",
      "Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => '' }, userAgent: 'node' }, configurable: true })",
      "globalThis.fetch = async () => ({ ok: false, json: async () => ({}) })",
      "export async function render(routeKey, viewMode) {",
      "  const now = new Date().toISOString()",
      "  const { createSampleState } = await import(" + JSON.stringify(path.join(root, "src", "core", "sample-data.ts").replace(/[\\]/g, "/")) + ")",
      "  const state = createSampleState(now, 'client-test')",
      "  const live = " + JSON.stringify(LIVE_STATE),
      "  state.projects[live.projId] = {",
      "    id: live.projId, name: 'AIControlPanel', description: 'workspace control surface', color: 'teal',",
      "    parentId: null, layout: 'board', order: 2, isFavorite: false, isArchived: false, createdAt: now, updatedAt: now,",
      "  }",
      "  state.sections = live.sections",
      "  state.tasks = Object.fromEntries(live.tasks.map((task) => [task.id, task]))",
      "  if (state.tasks['task-mvfs3y5s']) state.tasks['task-mvfs3y5s'].completedAt = now",
      "  window.localStorage.setItem('todoist-replica.state', JSON.stringify(state))",
      "  const React = (await import('react')).default",
      "  const { renderToStaticMarkup } = await import('react-dom/server')",
      "  const { ThemeProvider } = await import(" + JSON.stringify(path.join(root, "src", "styles", "theme.tsx").replace(/[\\]/g, "/")) + ")",
      "  const App = (await import(" + JSON.stringify(appPath.replace(/[\\]/g, "/")) + ")).default",
      "  globalThis.__DAYMARK_ROUTE__ = routeKey",
      "  globalThis.__DAYMARK_VIEW__ = viewMode",
      "  return renderToStaticMarkup(React.createElement(",
      "    ThemeProvider,",
      "    { children: React.createElement(App, { key: routeKey + ':' + viewMode }) },",
      "  ))",
      "}",
    ].join("\n");
    const entryPath = path.join(dir, "entry.mjs");
    writeFileSync(entryPath, entry);
    const outFile = path.join(dir, "bundle.mjs");
    await build({
      entryPoints: [entryPath],
      absWorkingDir: root,
      alias: { react: path.join(root, "node_modules", "react"), "react-dom": path.join(root, "node_modules", "react-dom") },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: outFile,
      loader: { ".css": "empty" },
      jsx: "automatic",
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: "silent",
    });
    const { render } = await import(pathToFileURL(outFile).href);
    return await render(route, viewMode);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (appPath) rmSync(appPath, { force: true });
  }
}

test("workspace Board view renders control sessions without crashing (was: task.details of undefined)", async () => {
  const html = await renderRoute("project:" + LIVE_STATE.projId, "board");
  assert.match(html, /board-view--workspace/);
  assert.match(html, /board-column--stage-todo/);
  assert.match(html, /board-task/);
});

test("Control Panel route renders without crashing (was: ReferenceError syncKey is not defined)", async () => {
  const html = await renderRoute("control", "list");
  assert.match(html, /AI control panel/);
  assert.match(html, /data-control-card=/);
});

test("buildControlSession sessions carry the details/note contract BoardTaskCard renders", async () => {
  const app = readFileSync(path.join(root, "src", "App.jsx"), "utf8");
  const fn = app.slice(app.indexOf("function buildControlSession("), app.indexOf("function controlBoardStage("));
  assert.ok(fn.length > 0);
  assert.match(fn, /details,/);
  assert.match(fn, /note:/);
  const card = app.slice(app.indexOf("function BoardTaskCard("), app.indexOf("function ControlCard("));
  // The card guards the render path; a bare task.details.length on the session
  // shape is exactly the crash this suite pins.
  assert.match(card, /task\.details\b/);
});

test("ControlPanelWorkspace declares syncKey in its props (was referenced bare)", async () => {
  const app = readFileSync(path.join(root, "src", "App.jsx"), "utf8");
  const start = app.indexOf("function ControlPanelWorkspace(");
  const fn = app.slice(start, app.indexOf("function UtilityPanel("));
  assert.match(fn, /\n  syncKey,\n/);
});
