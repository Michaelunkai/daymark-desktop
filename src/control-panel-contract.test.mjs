import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("AI control panel is presented as a live multi-session workspace", async () => {
  const [app, shellStyles] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8"),
  ]);

  const panelSource = app.slice(
    app.indexOf("function SessionCard("),
    app.indexOf("function UtilityPanel("),
  );

  assert.ok(panelSource.length > 0, "the control panel components must exist in App.jsx");
  assert.match(panelSource, /function ControlPanelWorkspace\(/);
  assert.match(panelSource, /WORKSPACE LIVE CONTROL/);
  assert.match(panelSource, /<h1>AI control panel<\/h1>/);
  assert.match(panelSource, /workspaceName/);
  assert.match(shellStyles, /\.control-card__workspace::before \{\s*\n?\s*content: 'Workspace · ';/);
  assert.match(panelSource, /Move to workspace…/);
  assert.match(panelSource, /session\.projectId/);
  assert.doesNotMatch(panelSource, /PROJECT VIEW/);
  assert.doesNotMatch(panelSource, /[Pp]roject (view|dialog|sidebar)/);
  assert.doesNotMatch(panelSource, /projectName/);

  assert.match(app, /\{ id: 'control', label: 'Control Panel', icon: 'board', count: 0 \}/);
  assert.match(app, /if \(route === 'control'\) \{\s*\n\s*return \{ title: 'AI control panel', kicker: 'WORKSPACE LIVE CONTROL'/);
  assert.match(app, /\) : route === 'control' \? \(\s*\n\s*<ControlPanelWorkspace/);
  assert.match(app, /item\.id === 'control'\s*\n\s*\? controlSessions\.length/);
  assert.match(app, /!\['order', 'control'\]\.includes\(route\)/);
  assert.match(app, /workspaces=\{Object\.values\(state\.projects\)/);
});

test("every In Progress task renders as a card in a side-by-side responsive grid", async () => {
  const [app, shellStyles] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /function controlBoardStage\(sectionName\) \{/);
  assert.match(app, /const controlBoardColumns = useMemo\(\(\) => \{/);
  assert.match(app, /columns\.inprogress\.filter\(\(session\) => !session\.completed\)\.sort\(byPriority\)/);
  assert.match(app, /const controlSessions = useMemo\(\(\) => controlBoardColumns\.inprogress/);
  assert.match(app, /<div className="control-grid">/);
  assert.match(shellStyles, /\.control-grid \{[\s\S]*?display: grid;/);
  assert.match(shellStyles, /\.control-grid \{[\s\S]*?grid-template-columns: repeat\(auto-fill, minmax\(min\(330px, 100%\), 1fr\)\);/);
  assert.match(shellStyles, /@media \(max-width: 720px\) \{[\s\S]*?\.control-grid \{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(shellStyles, /\.control-card \{[\s\S]*?border-radius: 12px;/);
  assert.match(app, /data-control-card=\{session\.id\}/);
});

test("each card leads with the newest prepended session update line", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  const patternSource = app.match(/const SESSION_UPDATE_LINE = (\/.+\/i)\r?\n/)?.[1];
  assert.ok(patternSource, "the session update line pattern must be declared");
  const closingSlash = patternSource.lastIndexOf("/");
  const updateLine = new RegExp(patternSource.slice(1, closingSlash), patternSource.slice(closingSlash + 1));
  const samples = [
    ["— update 14:32 —", "update", "14:32"],
    ["— heartbeat 09:05 —", "heartbeat", "09:05"],
    ["— REOPENED 22:10 —", "REOPENED", "22:10"],
  ];
  for (const [line, kind, time] of samples) {
    const match = line.match(updateLine);
    assert.ok(match, `pattern must match "${line}"`);
    assert.equal(match[1], kind);
    assert.equal(match[2], time);
  }
  assert.equal("no marker here".match(updateLine), null);

  assert.match(app, /function latestSessionUpdate\(description\) \{[\s\S]*?extractSessionUpdates\(description\)\[0\] \?\? null/);
  assert.match(app, /latestRelative: latest \? sessionUpdateRelative\(latest\.time\) : ''/);

  const cardSource = app.slice(app.indexOf("function SessionCard("), app.indexOf("function ControlPanelWorkspace("));
  const latestIndex = cardSource.indexOf("control-card__latest control-card__latest--");
  const titleIndex = cardSource.indexOf("control-card__title");
  const composerIndex = cardSource.indexOf("control-card__log");
  assert.ok(latestIndex >= 0 && titleIndex >= 0 && composerIndex >= 0);
  assert.ok(latestIndex < titleIndex, "the latest update band must render before the task title");
  assert.ok(titleIndex < composerIndex, "the full session log stays accessible below the headline");
  assert.match(cardSource, /\{session\.latestRelative\} · \{latest\.time\}/);
});

test("the panel refreshes live with a visible last-refresh time", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  assert.match(app, /const CONTROL_PANEL_REFRESH_MS = 6000/);
  assert.match(app, /function useControlPanelLiveRefresh\(enabled, intervalMs = CONTROL_PANEL_REFRESH_MS\) \{/);
  assert.match(app, /window\.setInterval\(refresh, intervalMs\)/);
  assert.match(app, /appStore\.reload\(\)/);
  assert.match(app, /const \{ lastRefreshedAt: controlPanelRefreshedAt, refreshNow: refreshControlPanelNow \} = useControlPanelLiveRefresh\(route === 'control'\)/);
  assert.match(app, /Live · refreshed \{refreshLabel\}/);
  assert.match(app, /<button className="secondary-button" onClick=\{onManualRefresh\} type="button">Refresh now<\/button>/);
});

test("humans and agents can perform every action from the panel without dead ends", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  const handlers = app.slice(app.indexOf("const ensureWorkspaceStageSection ="), app.indexOf("  const taskSiblings ="));
  assert.ok(handlers.length > 0, "control panel handlers must exist");
  assert.match(handlers, /type: 'task\.complete', taskId: session\.id/);
  assert.match(handlers, /type: 'task\.uncomplete', taskId: session\.id/);
  assert.match(handlers, /— REOPENED \$\{controlClock\(\)\} — Session reopened from the AI control panel\./);
  assert.match(handlers, /patch: \{ sectionId: sectionId \?\? null \}/);
  assert.match(handlers, /patch: \{ projectId, sectionId \}/);
  assert.match(handlers, /— update \$\{controlClock\(\)\} — \$\{text\}/);
  assert.match(handlers, /patch: \{ description \}/);
  assert.match(handlers, /type: 'task\.delete', taskId: session\.id/);
  assert.match(handlers, /type: 'task\.add',/);
  assert.match(handlers, /type: 'section\.add',/);
  assert.match(handlers, /patch: \{ description: session\.description \? `\$\{line\}\\n\$\{session\.description\}` : line \}/);

  const cardSource = app.slice(app.indexOf("function SessionCard("), app.indexOf("function ControlPanelWorkspace("));
  assert.match(cardSource, /aria-label=\{`Log an update for \$\{session\.title\}`\}/);
  assert.match(cardSource, /aria-label=\{`Move \$\{session\.title\} to another stage`\}/);
  assert.match(cardSource, /aria-label=\{`Move \$\{session\.title\} to another workspace`\}/);
  assert.match(cardSource, /control-card__action--complete/);
  assert.match(cardSource, /control-card__action--reopen/);
  assert.match(cardSource, /control-card__action--danger/);
  assert.match(cardSource, /control-card__hand"[\s\S]{0,200}data-hand-order=\{session\.id\}/);
  assert.match(app, /handOrderLine/);
  assert.match(cardSource, /Save description/);

  assert.match(app, /window\.DaymarkAI = \{/);
  assert.match(app, /daymark:agent-request/);
  assert.match(app, /projectId: requestedProjectId,/);
});

test("the control board lays out To do, In Progress, Finished left-to-right with In Progress four times wider", async () => {
  const [app, shellStyles] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8"),
  ]);

  const panelSource = app.slice(
    app.indexOf("function ControlPanelWorkspace("),
    app.indexOf("function UtilityPanel("),
  );

  const todoIndex = panelSource.indexOf("control-board__column--todo");
  const inProgressIndex = panelSource.indexOf("control-board__column--inprogress");
  const finishedIndex = panelSource.indexOf("control-board__column--finished");
  assert.ok(todoIndex >= 0, "the board must render a To do column");
  assert.ok(inProgressIndex >= 0, "the board must render an In Progress column");
  assert.ok(finishedIndex >= 0, "the board must render a Finished column");
  assert.ok(todoIndex < inProgressIndex, "To do must come before In Progress");
  assert.ok(inProgressIndex < finishedIndex, "Finished must sit immediately to the right of In Progress");

  // Headings may carry a jump button (smooth-scroll navigation); the visible
  // label and its left-to-right order are the contract.
  const findHeading = (label) => {
    const plain = panelSource.indexOf(`<h2>${label}</h2>`);
    return plain >= 0 ? plain : panelSource.indexOf(`>${label}</button>`);
  };
  const headingTodo = findHeading("To do");
  const headingInProgress = findHeading("In Progress");
  const headingFinished = findHeading("Finished");
  assert.ok(headingTodo >= 0 && headingInProgress >= 0 && headingFinished >= 0, "all three column headings must render");
  assert.ok(headingTodo < headingInProgress && headingInProgress < headingFinished, "headings must read To do, In Progress, Finished");

  const inProgressColumn = panelSource.slice(inProgressIndex, finishedIndex);
  assert.ok(inProgressColumn.includes("control-grid"), "the In Progress column must lay its session cards out side by side");
  assert.ok(inProgressColumn.includes("<SessionCard"), "the In Progress column must reuse the full session cards");

  assert.match(app, /const controlBoardColumns = useMemo\(\(\) => \{[\s\S]*?columns\.todo[\s\S]*?columns\.inprogress[\s\S]*?columns\.finished/);
  assert.match(app, /const \[layout, setLayout\] = useState\('board'\)/);
  assert.match(app, /onPromote=\{promoteControlTask\}/);
  assert.match(app, /board=\{controlBoardColumns\}/);

  // Layout contract: balanced-but-dominant columns (1fr 2fr 1fr) so a To-do
  // card fits its own Assign session/Start buttons, and row actions wrap
  // INSIDE their card instead of overflowing the column gutter.
  assert.match(shellStyles, /\.control-board \{\s*display: grid;\s*grid-template-columns: 1fr 2fr 1fr;/);
  assert.match(shellStyles, /\.control-board__row-actions \{[\s\S]*?flex-wrap: wrap;[\s\S]*?\}/);
  assert.match(shellStyles, /\.control-board__row-actions \{[^}]*max-width: 100%;[^}]*\}/);
  assert.match(shellStyles, /@media \(max-width: 1080px\) \{\s*\.control-board \{\s*grid-template-columns: 1fr;\s*\}\s*\}/);

  // Details contract: every Control Panel row shows a description preview
  // under the title, journal-line noise stripped, clamped to two lines.
  assert.match(app, /function controlRowDetails\(/);
  assert.match(app, /controlRowDetails\(session\)/);
  assert.match(app, /control-board__row-details/);
  assert.match(shellStyles, /\.control-board__row-details \{[\s\S]*?-webkit-line-clamp: 2;[\s\S]*?\}/);
});

test("the real AIControlPanel project board shows To do, In Progress, Finished side by side with In Progress four times taller", async () => {
  const [app, shellStyles] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /function isWorkspaceProject\(project\) \{\s*\n\s*\/\/ Workspaces are declared by convention: the project description begins with the marker word "workspace"\.\s*\n\s*return String\(project\?\.description \?\? ''\)\.trim\(\)\.toLowerCase\(\)\.startsWith\('workspace'\)/);
  assert.match(app, /const isWorkspace = route\.startsWith\('project:'\) && isWorkspaceProject\(state\.projects\[route\.slice\('project:'\.length\)\]\)/);
  assert.match(app, /const workspaceBoardColumns = useMemo\(\(\) => \{[\s\S]*?byKey\.get\('inprogress'\)\.tasks\.push\(session\)/);
  assert.match(app, /isWorkspace \? \(\s*\n\s*<div className="board-view board-view--workspace">/);
  assert.match(app, /className=\{`board-column board-column--stage-\$\{column\.key\}\$\{column\.key === 'inprogress' \? ' board-column--in-progress' : ''\}`\}/);
  assert.match(app, /kicker: workspace \? 'WORKSPACE LIVE BOARD' : 'PROJECT VIEW'/);

  assert.match(shellStyles, /\.board-view--workspace \{\s*grid-template-columns: none;\s*grid-auto-flow: column;\s*grid-auto-columns: minmax\(0, 1fr\);/);
  assert.match(shellStyles, /\.board-view--workspace \.board-column \{[\s\S]*?min-height: 260px;/);
  assert.match(shellStyles, /\.board-view--workspace \.board-column--in-progress \{\s*min-height: calc\(260px \* 4\);\s*\}/);
  assert.match(app, /defaultExpandedDetails=\{column\.key === 'inprogress'\}/);
});

test("the workspace board renders Finished exactly once — every section and task maps into the three canonical columns", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  const memoStart = app.indexOf("const workspaceBoardColumns = useMemo(");
  const memoEnd = app.indexOf("}, [isWorkspace, route, state, today])", memoStart);
  assert.ok(memoStart >= 0 && memoEnd > memoStart, "the canonical workspace board columns memo must exist");
  const memoSource = app.slice(memoStart, memoEnd);

  assert.equal(memoSource.split("name: 'To do'").length - 1, 1, "exactly one To do column is declared");
  assert.equal(memoSource.split("name: 'In Progress'").length - 1, 1, "exactly one In Progress column is declared");
  assert.equal(memoSource.split("name: 'Finished'").length - 1, 1, "exactly one Finished column is declared — no duplicates");
  assert.equal(memoSource.split(".tasks.push(session)").length - 1, 3, "every task is pushed into exactly one of the three buckets");
  assert.match(memoSource, /if \(task\.completedAt \|\| stage === 'finished'\) byKey\.get\('finished'\)\.tasks\.push\(session\)/);
  assert.match(memoSource, /const column = byKey\.get\(controlBoardStage\(section\.name\)\)/);
  assert.ok(app.includes("workspaceBoardSections") === false, "the old per-section workspace board must be gone");
  assert.ok(app.includes("controlStageRank") === false, "stage-rank section sorting is superseded by canonical columns");

  // The board markup renders the canonical columns, never a second section list.
  const boardStart = app.indexOf("isWorkspace ? (");
  const plainBoardIndex = app.indexOf('<div className="board-view">', boardStart);
  const boardSource = app.slice(boardStart, plainBoardIndex > boardStart ? plainBoardIndex : app.length);
  assert.match(boardSource, /\{workspaceBoardColumns\.map\(\(column\) => \(/);
  assert.doesNotMatch(boardSource, /workspaceBoardSections|sections\.map/);
  assert.match(app, /const ensureWorkspaceStageSection = \(projectId, stage\) => \{/);
  assert.match(app, /const ensureControlSection = \(projectId\) => ensureWorkspaceStageSection\(projectId, 'inprogress'\)/);
});

test("in-progress cards are large, wrapping and never clipped or overlapping", async () => {
  const shellStyles = await readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8");

  const inProgressCard = shellStyles.match(/\.board-view--workspace \.board-column--in-progress \.board-task \{[^}]*\}/)?.[0];
  assert.ok(inProgressCard, "in-progress card sizing rule must exist");
  assert.match(inProgressCard, /min-height: 96px;/);
  assert.match(inProgressCard, /padding: 16px;/);

  const updateBand = shellStyles.match(/^\.board-task__update \{[^}]*\}/m)?.[0];
  assert.ok(updateBand, "update band rule must exist");
  assert.match(updateBand, /flex-wrap: wrap;/);
  assert.ok(!/max-height/.test(updateBand), "the update band must never be height-clipped");
  assert.ok(!/overflow:\s*hidden/.test(updateBand), "the newest update line must never be overflow-hidden");
  assert.match(shellStyles, /^\.board-task__update-text \{[^}]*overflow-wrap: anywhere;/m);
  assert.match(shellStyles, /\.board-view--workspace \.board-task__update-text \{[^}]*white-space: normal;/);
  assert.match(shellStyles, /\.board-view--workspace \.board-column__body \{\s*gap: 12px;\s*padding: 12px;/);
});

test("a description-marked workspace project gets the workspace treatment; regular projects keep project treatment", async () => {
  const [app, taskEditor, shellStyles] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./features/task-editor/TaskEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8"),
  ]);

  // Sidebar: workspaces are grouped under their own WORKSPACES heading, above PROJECTS.
  const workspacesIndex = app.indexOf("title: 'WORKSPACES'");
  const projectsIndex = app.indexOf("title: 'PROJECTS'");
  assert.ok(workspacesIndex >= 0, "the sidebar must have a WORKSPACES group");
  assert.ok(projectsIndex > workspacesIndex, "WORKSPACES must be declared before PROJECTS");
  assert.match(app, /const workspaceSidebarItems = projectItems\.filter\(\(project\) => isWorkspaceProject\(project\)\)/);
  assert.match(app, /const regularProjectItems = projectItems\.filter\(\(project\) => !isWorkspaceProject\(project\)\)/);
  assert.match(app, /aria-label=\{group\.actionLabel\}/);
  assert.match(app, /actionLabel: 'Add workspace'/);
  assert.match(app, /actionLabel: 'Add project'/);

  // Workspace projects sort above regular projects.
  assert.match(app, /\.sort\(\(left, right\) => \(Number\(isWorkspaceProject\(right\)\) - Number\(isWorkspaceProject\(left\)\)\)\s*\n\s*\|\| left\.order - right\.order\),/);

  // Every "project" label flips to "workspace" for workspace contexts.
  assert.match(taskEditor, /projectLabel = 'Project'/);
  assert.match(taskEditor, /<label htmlFor=\{ids\.project\}>\{projectLabel\}<\/label>/);
  assert.match(taskEditor, /\{`Choose Inbox or a \$\{projectLabel\.toLowerCase\(\)\}`\}<\/option>/);
  assert.match(app, /projectLabel=\{isWorkspace \? 'Workspace' : 'Project'\}/);
  assert.match(app, /\{isWorkspace \? 'Nothing in this workspace yet' : 'No tasks in this view'\}/);
  assert.match(app, /kicker: workspace \? 'WORKSPACE LIVE BOARD' : 'PROJECT VIEW'/);
  assert.doesNotMatch(app, /aicontrolpanel/);
});

test("new session updates flash red for two minutes as the first line of every board card", async () => {
  const [app, shellStyles] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8"),
  ]);

  const flashMs = Number(app.match(/const CONTROL_UPDATE_FLASH_MS = (\d+)/)?.[1]);
  assert.equal(flashMs, 120000, "new updates must flash red for exactly 2 minutes");
  assert.match(app, /const CONTROL_UPDATE_SEEN_KEY = 'daymark\.control-update-seen'/);
  assert.match(app, /function controlUpdateSignature\(latest\) \{\s*\n\s*return latest \? `\$\{latest\.kind\}\|\$\{latest\.time\}\|\$\{latest\.body\}` : ''/);
  assert.match(app, /function markControlUpdateSeen\(taskId, signature, seenAt = Date\.now\(\)\)/);
  assert.match(app, /function useSessionUpdateFlash\(taskId, latest\) \{[\s\S]*?const expiresAt = \(isNew \? Date\.now\(\) : seen\.seenAt\) \+ CONTROL_UPDATE_FLASH_MS/);
  assert.match(app, /const latestUpdate = latestSessionUpdate\(task\.description\)\s*\n\s*const updateFlashing = useSessionUpdateFlash\(task\.id, latestUpdate\)/);

  const cardSource = app.slice(app.indexOf("function BoardTaskCard("), app.indexOf("function ControlBoardRow(") >= 0 ? app.indexOf("function ControlBoardRow(") : app.length);
  const updateIndex = cardSource.indexOf("board-task__update");
  const titleIndex = cardSource.indexOf("<strong>{task.title}</strong>");
  assert.ok(updateIndex >= 0 && titleIndex >= 0);
  assert.ok(updateIndex < titleIndex, "the update line must be the very first line of the card");
  assert.match(cardSource, /className=\{`board-task__update\$\{updateFlashing \? ' is-new' : ''\}`\}/);

  assert.match(shellStyles, /\.board-task__update\.is-new \{[\s\S]*?border-left-color: var\(--color-danger\);[\s\S]*?background: color-mix\(in srgb, var\(--color-danger\) 12%, var\(--surface\)\);/);
  assert.match(shellStyles, /\.board-task__update\.is-new \.board-task__update-text,[\s\S]*?color: var\(--color-danger\);/);
});

test("user actions flush to the server instantly — no debounce, timed confirmation, backoff never reverts", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  // The push scheduler must flag the push synchronously and fire it with zero debounce.
  assert.match(app, /syncPushRequestedRef\.current = true\n    const generation = syncGenerationRef\.current/);
  assert.match(app, /syncPushTimerRef\.current = window\.setTimeout\(async \(\) => \{/);
  const schedulerStart = app.indexOf("syncPushRequestedRef.current = true\n    const generation");
  const schedulerClose = app.indexOf("}, 0)", schedulerStart);
  assert.ok(schedulerClose > schedulerStart, "the push scheduler must fire with a 0ms (same-frame) timer");
  const schedulerSource = app.slice(schedulerStart, schedulerClose + 5);
  assert.ok(!/},\s*[1-9]/.test(schedulerSource), "no positive debounce delay may gate the push");

  // Timing instrumentation: server confirmation is measured and logged.
  assert.match(app, /const pushStartedAt = performance\.now\(\)/);
  assert.match(app, /console\.info\(`\[daymark\] sync push confirmed in \$\{Math\.round\(performance\.now\(\) - pushStartedAt\)\}ms \(revision \$\{pushed\.revision\}\)`\)/);

  // Failed pushes retry with backoff, keep the optimistic state, and never revert the store.
  assert.match(app, /console\.warn\(`\[daymark\] sync push failed — retrying in \$\{retryDelay\}ms`\)/);
  assert.match(app, /const retryDelay = Math\.min\(\s*\n\s*10_000,\s*\n\s*250 \* \(2 \*\* Math\.min\(syncPushRetryCountRef\.current - 1, 5\)\),\s*\n\s*\)/);
  const catchStart = app.indexOf("      } catch (error) {\n        if (\n          runner.controller.signal.aborted ||");
  const catchEnd = app.indexOf("      } finally {", catchStart);
  assert.ok(catchStart >= 0 && catchEnd > catchStart, "the push runner catch block must exist");
  const catchSource = app.slice(catchStart, catchEnd);
  assert.match(catchSource, /syncPushRequestedRef\.current = true/);
  assert.doesNotMatch(catchSource, /appStore\.(replace|reload|dispatch|reset)/);

  // Behavioral proof on the real sync wire path: mocked fetch, push fires synchronously and confirms <1s.
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const scratch = mkdtempSync(path.join(tmpdir(), "daymark-push-timing-"));
  const childScript = path.join(scratch, "push-timing.mjs");
  writeFileSync(childScript, `
    import { pushSyncState } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "src", "core", "sync.ts")).href)}
    import { createSampleState } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "src", "core", "sample-data.ts")).href)}
    const calls = []
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", at: Date.now() })
      await new Promise((resolve) => setTimeout(resolve, 40))
      const state = { ...createSampleState(), revision: 9 }
      return new Response(JSON.stringify({ state, revision: 9 }), { status: 200, headers: { "content-type": "application/json" } })
    }
    const startedAt = Date.now()
    const result = await pushSyncState("timing-key", { ...createSampleState(), revision: 8 }, 8)
    console.log(JSON.stringify({
      elapsedMs: Date.now() - startedAt,
      fetchCount: calls.length,
      method: calls[0]?.method ?? "",
      fetchFiredWithinMs: calls[0] ? calls[0].at - startedAt : -1,
      revision: result.revision,
    }))
  `);
  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", childScript], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60000,
    });
    const timing = JSON.parse(stdout.trim().split("\n").filter((line) => line.startsWith("{")).pop());
    assert.equal(timing.fetchCount, 1, "exactly one PUT must carry the change");
    assert.equal(timing.method, "PUT");
    assert.ok(timing.fetchFiredWithinMs <= 25, `fetch must fire synchronously (fired after ${timing.fetchFiredWithinMs}ms)`);
    assert.ok(timing.elapsedMs < 1000, `server confirmation must land under 1s (took ${timing.elapsedMs}ms)`);
    assert.equal(timing.revision, 9);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("every card in every column exposes an X that deletes immediately — open or completed", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  const boardCardSource = app.slice(app.indexOf("function BoardTaskCard("), app.indexOf("function ControlBoardRow("));
  assert.match(boardCardSource, /aria-label=\{\`Delete \$\{task\.title\}\`\}/);
  assert.match(boardCardSource, /className="icon-button board-task__delete"/);
  assert.match(boardCardSource, /data-delete-task=\{task\.id\}/);
  assert.match(boardCardSource, /onDelete\(task\.id\)/);
  assert.match(boardCardSource, /<Icon name="close" size=\{15\} \/>/);

  const rowSource = app.slice(app.indexOf("function ControlBoardRow("), app.indexOf("function ControlPanelWorkspace("));
  assert.match(rowSource, /data-delete-task=\{session\.id\}/);
  assert.match(rowSource, /aria-label=\{\`Delete \$\{session\.title\}\`\}/);
  assert.match(rowSource, /onClick=\{\(\) => onDelete\(session\)\}/);

  const sessionCardSource = app.slice(app.indexOf("function SessionCard("), app.indexOf("function UtilityPanel("));
  assert.match(sessionCardSource, /control-card__action--danger" data-delete-task=\{session\.id\}/);

  // Delete is immediate for open AND completed tasks: no confirmation dialog anywhere in the path.
  const handlers = app.slice(app.indexOf("const deleteBoardTask ="), app.indexOf("  const taskSiblings ="));
  assert.match(handlers, /const deleteBoardTask = \(taskId\) => \{/);
  assert.match(handlers, /type: 'task\.delete', taskId \}/);
  assert.match(handlers, /const deleteControlTask = \(session\) => \{/);
  assert.match(handlers, /type: 'task\.delete', taskId: session\.id \}/);
  assert.match(handlers, /setUndoAvailable\(true\)/);
  assert.doesNotMatch(handlers, /setConfirmation|completedAt/);

  // Both board branches and the control route wire the delete affordance.
  assert.match(app, /onDelete=\{deleteBoardTask\}/);
  const boardStart = app.indexOf("isWorkspace ? (");
  const boardSlice = app.slice(boardStart, app.indexOf("task-canvas", boardStart));
  assert.equal(boardSlice.split("onDelete={deleteBoardTask}").length - 1, 2, "workspace and regular board columns both expose delete");
});

test("assign session pins the task to the top of In Progress via the — pinned — marker and low order", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  // Pinning convention: literal marker line is the first description line.
  assert.match(app, /const PINNED_MARKER = '— pinned —'/);
  assert.match(app, /function isTaskPinned\(description\) \{\s*\n\s*return String\(description \?\? ''\)\.split\(\/\\r\?\\n\/\)\[0\]\?\.trim\(\) === PINNED_MARKER/);
  assert.match(app, /pinned: isTaskPinned\(task\.description\)/);

  // The assign handler moves the task, prepends the journal update line plus the
  // pin marker, and lowers the order so server ordering puts it first.
  const handlers = app.slice(app.indexOf("const assignControlSession ="), app.indexOf("const deleteBoardTask ="));
  assert.ok(handlers.length > 0, "the assignControlSession handler must exist");
  assert.match(handlers, /const sectionId = ensureControlSection\(session\.projectId\)/);
  assert.match(handlers, /— update \$\{controlClock\(\)\} — \$\{ASSIGN_SESSION_UPDATE_LINE\}/);
  assert.match(app, /const ASSIGN_SESSION_UPDATE_LINE = 'session assigned and pinned for this task'/);
  assert.match(handlers, /order: minOrder - 1000/);
  assert.match(handlers, /description: session\.description \? `\$\{pinnedBlock\}\\n\$\{session\.description\}` : pinnedBlock/);
  assert.match(handlers, /type: 'task\.update',/);

  // Sequential auto-run: assign only ENQUEUES the session; the queue runner
  // (not the click) launches it after the previous session finished, honoring
  // the header start-delay picker.
  assert.match(handlers, /readAutoQueue\(\)/);
  assert.match(handlers, /writeAutoQueue\(queue\)/);
  assert.doesNotMatch(handlers, /window\.DaymarkAI\?\.startSession\?\.\(/);
  const queueRunner = app.slice(app.indexOf("// Sequential auto-run queue runner"), app.indexOf("const channel = typeof BroadcastChannel"));
  assert.ok(queueRunner.length > 0, "the auto-run queue runner effect must exist");
  assert.match(queueRunner, /window\.DaymarkAI\?\.startSession\?\.\(/);
  assert.match(queueRunner, /readAutoDelayMinutes\(\) \* 60000/);
  assert.match(queueRunner, /stageOf\(task\) === 'finished'/);
  assert.match(queueRunner, /Boolean\(task\.completedAt\)/);
  assert.match(app, /function readAutoQueue\(\)/);
  assert.match(app, /function readAutoDelayMinutes\(\)/);
  assert.match(app, /const AUTO_DELAY_CHOICES = \[0, 1, 2, 3, 5, 10, 15, 30\]/);
  // Header start-delay picker wired to the persisted delay key.
  const delayPickerIndex = app.indexOf('className="control-panel__delay"');
  const delayPicker = app.slice(delayPickerIndex, delayPickerIndex + 600);
  assert.match(delayPicker, /AUTO_DELAY_CHOICES\.map/);
  assert.match(delayPicker, /changeStartDelay\(Number\(event\.target\.value\)\)/);
  assert.match(app, /localStorage\.setItem\(AUTO_DELAY_KEY, String\(minutes\)\)/);

  // Pinned sessions sort to the very top of both In Progress columns.
  assert.match(app, /function sortPinnedFirst\(tasks\) \{\s*\n\s*return \[\.\.\.tasks\.filter\(\(session\) => session\.pinned\), \.\.\.tasks\.filter\(\(session\) => !session\.pinned\)\]/);
  const controlMemo = app.slice(app.indexOf("const controlBoardColumns = useMemo("), app.indexOf("const controlSessions = useMemo("));
  assert.match(controlMemo, /columns\.inprogress = sortPinnedFirst\(columns\.inprogress\)/);
  const workspaceMemoStart = app.indexOf("const workspaceBoardColumns = useMemo(");
  const workspaceMemoEnd = app.indexOf("}, [isWorkspace, route, state, today])", workspaceMemoStart);
  assert.match(app.slice(workspaceMemoStart, workspaceMemoEnd), /if \(column\.key === 'inprogress'\) column\.tasks = sortPinnedFirst\(column\.tasks\)/);

  // A visible pinned badge renders on board cards and In Progress session cards.
  const boardCardSource = app.slice(app.indexOf("function BoardTaskCard("), app.indexOf("function TaskComposer("));
  assert.match(boardCardSource, /\{task\.pinned \? <span className="board-task__pinned"[^>]*>pinned<\/span> : null\}/);
  const sessionCardSource = app.slice(app.indexOf("function SessionCard("), app.indexOf("function ControlBoardRow("));
  assert.match(sessionCardSource, /control-card__pinned/);

  // Every To do card exposes the action (workspace board, plain board, control board).
  assert.match(app, /onAssign=\{column\.key === 'todo' \? assignControlSession : undefined\}/);
  assert.match(app, /data-assign-session=\{task\.id\}/);
  assert.match(app, /data-assign-session=\{session\.id\}/);
  assert.match(app, /<ControlBoardRow\s*\n\s*key=\{session\.id\}\s*\n\s*onAssign=\{onAssign\}/);
  assert.match(app, /onAssign=\{assignControlSession\}/);
});

test("every task card can attach files through the agent attachment endpoints", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const shellStyles = await readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8");

  const attachmentsSource = app.slice(app.indexOf("function TaskAttachments("), app.indexOf("function AttachmentItem("));
  assert.ok(attachmentsSource.length > 0, "the TaskAttachments component must exist");

  // Upload + list go through the agent face: POST /api/agent/v1/tasks/<ID>/attachments.
  assert.match(attachmentsSource, /`\/api\/agent\/v1\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/attachments`/);
  assert.match(attachmentsSource, /method: 'POST'/);
  assert.match(attachmentsSource, /body: JSON\.stringify\(\{\s*\n\s*dataBase64,\s*\n\s*mimeType: file\.type \|\| 'application\/octet-stream',\s*\n\s*name: file\.name,\s*\n\s*\}\)/);
  assert.match(attachmentsSource, /attachmentAuthHeaders\(syncKey\)/);

  // Raw bytes come from the keyless JSON endpoint /api/sync/attachment/<id>.
  assert.match(app, /function attachmentBytesUrl\(attachmentId\) \{\s*\n\s*return `\/api\/sync\/attachment\/\$\{encodeURIComponent\(attachmentId\)\}`/);
  assert.match(app, /async function fetchAttachmentBytes\(syncKey, attachmentId\)/);
  assert.match(app, /headers: attachmentAuthHeaders\(syncKey\),/);
  assert.match(app, /typeof payload\.dataBase64 !== 'string'/);
  assert.match(app, /function base64ToObjectUrl\(dataBase64, mimeType\)/);
  assert.match(app, /URL\.createObjectURL\(new Blob\(\[bytes\], \{ type: mimeType \|\| 'application\/octet-stream' \}\)\)/);

  // Files are read with FileReader and the data: prefix is stripped.
  assert.match(app, /function readFileAsBase64\(file\) \{[\s\S]*?const reader = new FileReader\(\)[\s\S]*?reader\.readAsDataURL\(file\)/);
  assert.match(app, /resolve\(commaIndex >= 0 \? result\.slice\(commaIndex \+ 1\) : result\)/);

  // Any file type, any number of files.
  assert.match(attachmentsSource, /<input hidden multiple onChange=\{handleFiles\} ref=\{inputRef\} type="file" \/>/);

  // Graceful degradation: endpoint failures show a hint instead of crashing.
  assert.match(attachmentsSource, /Attachments unavailable\.<\/small>/);
  assert.match(app, /if \(!response\.ok\) throw new Error\(String\(response\.status\)\)/);
  assert.doesNotMatch(attachmentsSource, /throw new Error\("HTTP/);

  // Images render as blob thumbnails; everything else is a name+icon download chip.
  const itemSource = app.slice(app.indexOf("function AttachmentItem("), app.indexOf("function BoardTaskCard("));
  assert.match(app, /function isImageMime\(mimeType\)/);
  assert.match(itemSource, /isImageMime\(attachment\.mimeType\) && objectUrl \? \(/);
  assert.match(itemSource, /<img/);
  assert.match(itemSource, /loading="lazy"/);
  assert.match(itemSource, /link\.download = attachment\.name \|\| 'attachment'/);
  assert.match(itemSource, /URL\.revokeObjectURL\(revoked\)/);
  assert.match(app, /function formatAttachmentSize\(size\)/);

  // The attach affordance is rendered on board cards and session cards.
  const boardCardSource = app.slice(app.indexOf("function BoardTaskCard("), app.indexOf("function TaskComposer("));
  assert.match(boardCardSource, /<TaskAttachments initialAttachments=\{task\.attachments\} syncKey=\{syncKey\} taskId=\{task\.id\} \/>/);
  const sessionCardSource = app.slice(app.indexOf("function SessionCard("), app.indexOf("function ControlBoardRow("));
  assert.match(sessionCardSource, /<TaskAttachments initialAttachments=\{session\.attachments\} syncKey=\{syncKey\} taskId=\{session\.id\} \/>/);

  // Server-provided attachment metadata flows into the view models.
  assert.match(app, /attachments: Array\.isArray\(task\.attachments\) \? task\.attachments : null/);

  // Styling exists for the badge, chips, and thumbnails (anchor and button faces).
  assert.match(shellStyles, /\.board-task__pinned,\s*\n\.control-card__pinned \{/);
  assert.match(shellStyles, /\.board-task__attachment-list a,\n\.board-task__attachment-link \{/);
  assert.match(shellStyles, /\.board-task__attachment-thumb \{[^}]*object-fit: cover;/);
  assert.match(shellStyles, /\.board-task__attachments \{[^}]*flex-wrap: wrap;/);
});

test("creating a new task from the panel or workspace defaults to the To do section", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  assert.match(app, /const defaultTodoSectionId = \(projectId\) => \{[\s\S]*?sections\.find\(\(section\) => controlBoardStage\(section\.name\) === 'todo'\) \?\? sections\[0\]/);

  // Control panel composer: new sessions open in To do, not In Progress.
  const composer = app.slice(app.indexOf("const createControlSession ="), app.indexOf("  const taskSiblings ="));
  assert.match(composer, /const sectionId = ensureWorkspaceStageSection\(requestedProjectId, stage\)/);

  // Quick composer: picks the project's To do section.
  const quickSubmit = app.slice(app.indexOf("const submitTask = (event) => {"), app.indexOf("const openTaskEditor ="));
  assert.match(quickSubmit, /const sectionId = defaultTodoSectionId\(projectId\)/);

  // Full task editor: creation without an explicit section falls back to To do.
  assert.match(app, /sectionId: adapted\.value\.sectionId \|\| defaultTodoSectionId\(adapted\.value\.projectId\)/);
});

test("every board card exposes a Message action that prepends a `— message` line to the TOP of the description", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const shellStyles = await readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8");

  // Handler exists and uses the real-time journal format both apps parse.
  const handlerStart = app.indexOf("const messageControlTask =");
  const handlerEnd = app.indexOf("  // One-shot imperative orders");
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "the messageControlTask handler must exist");
  const handlerSource = app.slice(handlerStart, handlerEnd);
  assert.match(handlerSource, /messagePrefixLine\(trimmed\)/);
  assert.ok(handlerSource.includes("replace(/\\s+/g, ' ').trim()"), "multi-line input collapses to one line");
  assert.match(handlerSource, /if \(!trimmed\) return false/, "empty sends are ignored");
  assert.match(handlerSource, /type: 'task\.update',/);
  assert.match(handlerSource, /taskId: task\.id,/);
  assert.match(handlerSource, /patch: \{ description \}/);
  // The — pinned — marker handling is delegated to prependJournalLine.
  assert.match(handlerSource, /prependJournalLine/);

  // Behavioral proof of the prepend + reopen semantics on the extracted handler.
  const functionSource = handlerSource.replace("const messageControlTask = (task, text) =>", "return (task, text) =>");
  const store = { dispatchCalls: [] };
  const sendMessage = new Function(
    "appStore",
    "state",
    "setNotice",
    "controlBoardStage",
    "ensureControlSection",
    "prependJournalLine",
    "messagePrefixLine",
    "reopenedFromMessageLine",
    `${functionSource}\n`,
  )(
    {
      getState: () => ({ tasks: store.tasks ?? {} }),
      dispatch: (action) => { store.dispatchCalls.push(action); return { ok: true } },
    },
    { sections: { s1: { name: "Finished" }, s2: { name: "In Progress" } } },
    () => {},
    (name) => ({ finished: "finished", "in progress": "inprogress", "to do": "todo" }[String(name ?? "").toLowerCase()] ?? null),
    () => "s2",
    // Faithful stand-in for prependJournalLine: keeps a leading pin marker first.
    (description, line) => {
      const pin = "— pinned —\n";
      if (description.startsWith(pin)) return `${pin}${line}\n${description.slice(pin.length)}`;
      return description ? `${line}\n${description}` : line;
    },
    (text) => `— message 08:05 — ${text}`,
    () => "— REOPENED 08:05 — continued by user message",
  );
  const descriptionOf = () => store.dispatchCalls.at(-1)?.patch?.description;

  // Plain running task: message becomes the new first line, all prior lines kept.
  store.tasks = { t1: { id: "t1", description: "line one\nline two", sectionId: "s2" } };
  sendMessage({ id: "t1", description: "line one\nline two", sectionId: "s2" }, "  please\n rerun   tests ");
  assert.equal(descriptionOf(), "— message 08:05 — please rerun tests\nline one\nline two");

  // Pinned task: message lands directly below the pin marker.
  store.tasks = { t2: { id: "t2", description: "— pinned —\n— update 07:00 — assigned\noriginal", sectionId: "s2" } };
  sendMessage({ id: "t2", description: "— pinned —\n— update 07:00 — assigned\noriginal", sectionId: "s2" }, "hello session");
  assert.equal(
    descriptionOf(),
    "— pinned —\n— message 08:05 — hello session\n— update 07:00 — assigned\noriginal",
  );

  // Finished (completed) task: reopen first — uncomplete + section move + REOPENED line.
  store.tasks = { t3: { id: "t3", description: "done work", sectionId: "s1", completedAt: "2026-10-20T10:00:00" } };
  sendMessage({ id: "t3", description: "done work", sectionId: "s1", completed: true }, "one more pass");
  assert.ok(store.dispatchCalls.some((action) => action.type === "task.uncomplete" && action.taskId === "t3"), "completed tasks are uncompleted first");
  assert.ok(store.dispatchCalls.some((action) => action.type === "task.update" && action.patch?.sectionId === "s2"), "finished tasks move back to In Progress");
  assert.equal(descriptionOf(), "— message 08:05 — one more pass\n— REOPENED 08:05 — continued by user message\ndone work");

  // Task in a Finished section but not completed reopens too.
  store.tasks = { t4: { id: "t4", description: "parked", sectionId: "s1" } };
  sendMessage({ id: "t4", description: "parked", sectionId: "s1" }, "again");
  assert.ok(store.dispatchCalls.some((action) => action.type === "task.uncomplete" && action.taskId === "t4"));
  assert.match(descriptionOf(), /^— message 08:05 — again\n— REOPENED 08:05 — continued by user message\nparked$/);

  // Empty input edge case.
  const callsBefore = store.dispatchCalls.length;
  sendMessage({ id: "t5", description: "keep", sectionId: "s2" }, "   \n  ");
  assert.equal(store.dispatchCalls.length, callsBefore, "empty messages must not dispatch");

  // The board cards render the compact toggle plus the composer, wired to the handler.
  const boardCardSource = app.slice(app.indexOf("function BoardTaskCard("), app.indexOf("function TaskComposer("));
  assert.match(boardCardSource, /className="icon-button board-task__message-toggle"/);
  assert.match(boardCardSource, /aria-label=\{`Message session \$\{task\.title\}`\}/);
  assert.match(boardCardSource, /aria-expanded=\{messageOpen\}/);
  assert.match(boardCardSource, /className="board-task__message"/);
  assert.match(boardCardSource, /className="board-task__message-input"/);
  assert.match(boardCardSource, /placeholder="Message the session — Enter sends"/);
  assert.match(boardCardSource, /className="primary-button board-task__message-send" disabled=\{!messageDraft\.trim\(\)\}/);
  assert.match(boardCardSource, /onMessage\(task, messageDraft\)/);
  assert.match(boardCardSource, /messageOpen \|\| detailsExpanded/, "the composer shows when expanded or toggled");
  assert.doesNotMatch(boardCardSource, /<textarea/, "single-line input keeps Enter = send");
  // Messaging finished tasks is allowed (they get reopened by the handler).
  assert.doesNotMatch(boardCardSource, /onMessage && !task\.completed/, "finished cards must keep the Message action");

  // Both board branches plus the Control Panel session cards wire the handler.
  assert.equal(app.split("onMessage={messageControlTask}").length - 1, 3, "workspace board, plain board, and Control Panel cards all expose messaging");

  // Hand ORDER button: board cards expose it exactly like Control Panel cards.
  assert.match(boardCardSource, /onHand,/, "board cards accept the onHand handler");
  assert.match(boardCardSource, /data-hand-order=\{task\.id\}/);
  assert.match(boardCardSource, /board-task__hand/);
  assert.equal(app.split("onHand={handControlTask}").length - 1, 3, "workspace board, plain board, and Control Panel cards all expose the Hand order");
  assert.match(shellStyles, /\.board-task__hand \{/);

  // Vanta-black theme styling exists for the composer.
  assert.match(shellStyles, /\.board-task__message \{[^}]*display: flex;/);
  assert.match(shellStyles, /\.board-task__message-input \{[^}]*background: var\(--surface-soft\);/);
  assert.match(shellStyles, /\.board-task__message-input \{[^}]*color: var\(--ink\);/);
  assert.match(shellStyles, /\.board-task__message-input:focus-visible \{[^}]*outline: 2px solid var\(--focus\);/);
});

test("agents journal lines parse into a newest-wins count and render as an agents pill with a control", async () => {
  const { parseAgentCount, subAgentsCreateLine, subAgentsStopLine } = await import(
    new URL("./features/workspace/board-model.ts", import.meta.url).href
  );
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const shellStyles = await readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8");

  // Parsing: `— agents <N> —`, newest occurrence wins.
  assert.equal(parseAgentCount("— agents 3 —\n— update 10:00 — working"), 3);
  assert.equal(parseAgentCount("— agents 4 —\n— agents 1 —"), 4, "newest (prepended) occurrence wins");
  assert.equal(parseAgentCount("— update 10:00 — no agents here"), null);
  assert.equal(parseAgentCount(""), null);
  assert.equal(parseAgentCount("— agents 0 —"), 0);
  assert.equal(parseAgentCount("— agents x —"), null);
  // Live phrasings sessions actually write (permanent exact-count law).
  assert.equal(parseAgentCount("— update 10:00 — 2 agents streaming, report in 2 min"), 2);
  assert.equal(parseAgentCount("— update 10:00 — 3 agents working, ETA 5 min"), 3);
  assert.equal(parseAgentCount("— update 10:00 — 3 agents running (1 done, 1 streaming)"), 3, "leading count is exact still-running");
  assert.equal(parseAgentCount("— update 10:00 — all agents done"), 0);
  assert.equal(parseAgentCount("— update 10:00 — all 3 agents finished"), 0);
  assert.equal(parseAgentCount("— ack 10:00 — dispatched 4 sub-agents and they are running"), 4);

  // Session cards: pill plus compact control (input N + create / stop all).
  const cardSource = app.slice(app.indexOf("function SessionCard("), app.indexOf("function ControlBoardRow("));
  assert.match(cardSource, /control-card__chip--agents/);
  assert.match(cardSource, /🤖 \{session\.agents\} agents/);
  assert.match(cardSource, /data-agents-control=\{session\.id\}/);
  assert.match(cardSource, /onSubAgentsCreate\?\.\(session, count\)/);
  assert.match(cardSource, /onSubAgentsStop\(session\)/);
  assert.match(cardSource, /Stop all/);
  // Wiring: ORDER helpers are dispatched from App.
  assert.match(app, /const createSubAgents = \(session, count\) => orderControlTask\(session, subAgentsCreateLine\(count\)\)/);
  assert.match(app, /const stopSubAgents = \(session\) => orderControlTask\(session, subAgentsStopLine\(\)\)/);
  assert.equal(app.split("onSubAgentsCreate={onSubAgentsCreate}").length - 1, 2, "both SessionCard call sites get the agents control");
  assert.match(shellStyles, /\.control-card__agents \{/);
});

test("ORDER journal line helpers format one-shot user commands", async () => {
  const { orderPrefixLine, stepOrderLine, subAgentsCreateLine, subAgentsStopLine, parseAgentCount } = await import(
    new URL("./features/workspace/board-model.ts", import.meta.url).href
  );
  const at = new Date(2026, 9, 20, 9, 7);

  assert.equal(orderPrefixLine("do X", at), "— ORDER 09:07 — do X");
  assert.equal(
    stepOrderLine("also update the README", at),
    "— ORDER 09:07 — do this now: also update the README; when finished continue exactly where you left off",
  );
  assert.equal(subAgentsCreateLine(3, at), "— ORDER 09:07 — sub-agents: create exactly 3 sub-agents");
  assert.equal(subAgentsStopLine(at), "— ORDER 09:07 — sub-agents: stop all sub-agents now");

  // App wires the add-step card action through stepOrderLine.
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(app, /const addControlStep = \(session, text\) => orderControlTask\(session, stepOrderLine\(text\)\)/);
  assert.match(app, /data-step-form=\{session\.id\}/);
  assert.match(app, /Add step/);
  // ORDER lines are recognized by the shared session-update parser.
  assert.match(app, /\(update\|heartbeat\|message\|ORDER\|REOPENED\|PAUSED\|RESUMED\)/);
});

test("unanswered messages show an awaiting indicator and auto-nudge at most twice", async () => {
  const { pendingMessageState, orderPrefixLine } = await import(
    new URL("./features/workspace/board-model.ts", import.meta.url).href
  );
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  const at = new Date(2026, 9, 20, 10, 3);
  const message = "— message 10:00 — please continue";
  // Pending right after the message: no agent life signal is newer.
  assert.deepEqual(pendingMessageState(`— pinned —\n${message}\n— update 09:00 — earlier`, at), {
    pending: true,
    elapsedSec: 180,
    nudges: 0,
  });
  // A newer (prepended above) update/heartbeat/REOPENED line clears the awaiting state.
  assert.equal(pendingMessageState(`— update 10:02 — done\n${message}`, at).pending, false);
  assert.equal(pendingMessageState(`— heartbeat 10:01 — alive\n${message}`, at).pending, false);
  assert.equal(pendingMessageState(`— REOPENED 10:01 — x\n${message}`, at).pending, false);
  // An OLDER update line below the message does not clear it.
  assert.equal(pendingMessageState(`${message}\n— update 09:58 — older`, at).pending, true);
  // ORDER lines (our own nudges) do NOT clear it and are counted.
  assert.deepEqual(
    pendingMessageState(`${orderPrefixLine("unanswered message nudge: reply to the message above now", at)}\n${message}`, at),
    { pending: true, elapsedSec: 180, nudges: 1 },
  );
  assert.equal(pendingMessageState("no message here", at).pending, false);
  assert.equal(pendingMessageState("", at).pending, false);

  // Card UI + nudge law wiring.
  assert.match(app, /CONTROL_NUDGE_AFTER_MS = 90000/);
  assert.match(app, /CONTROL_NUDGE_MAX = 2/);
  assert.match(app, /unanswered message nudge: reply to the message above now/);
  assert.match(app, /data-awaiting-reply=\{session\.id\}/);
  assert.match(app, /Awaiting reply · \{pending\.elapsedSec\}s/);
  const cardSource = app.slice(app.indexOf("function SessionCard("), app.indexOf("function ControlBoardRow("));
  assert.match(cardSource, /pendingMessageState\(session\.description \?\? '', new Date\(tickMs\)\)/);
});

test("usage meters prefer the desktop quota IPC, then the cache, then the legacy used-pct contract", async () => {
  const usageSource = await import(new URL("./features/workspace/usage-source.ts", import.meta.url).href);
  const { readUsageQuotaSnapshot, USAGE_QUOTA_CACHE_STORAGE_KEY, QUOTA_STALE_MS } = usageSource;
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const metersSource = await readFile(new URL("./features/workspace/UsageMeters.tsx", import.meta.url), "utf8");

  assert.equal(QUOTA_STALE_MS, 30 * 60 * 1000, "the cache goes stale after 30 minutes");

  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const previousWindow = globalThis.window;
  const previousQuota = globalThis.window?.__daymarkUsageQuota;
  const previousUsage = globalThis.window?.__daymarkUsage;
  try {
    const fresh = Date.now();
    // 1. Preferred: desktop quota IPC with REMAINING percentages.
    globalThis.window = {
      __daymarkUsageQuota: () => ({
        fiveHour: { remainingPct: 72, resetsAtMs: fresh + 3600_000, updatedAt: fresh },
        sevenDay: { remainingPct: 43, updatedAt: fresh },
      }),
    };
    let snapshot = readUsageQuotaSnapshot(fresh);
    assert.equal(snapshot.stale, false);
    assert.equal(snapshot.fiveHour.remainingPct, 72);
    assert.equal(snapshot.sevenDay.remainingPct, 43);
    assert.equal(snapshot.fiveHour.resetsAtMs, fresh + 3600_000);

    // 2. Cache fallback: same shape from localStorage, stale after 30 minutes.
    globalThis.window = {};
    storage.set(
      USAGE_QUOTA_CACHE_STORAGE_KEY,
      JSON.stringify({
        fiveHour: { remainingPct: 55, resetsAtMs: fresh + 60_000, updatedAt: fresh - QUOTA_STALE_MS - 1000 },
      }),
    );
    snapshot = readUsageQuotaSnapshot(fresh);
    assert.equal(snapshot.fiveHour.remainingPct, 55);
    assert.equal(snapshot.sevenDay, null);
    assert.equal(snapshot.stale, true, "a cache older than 30 minutes is marked stale");
    storage.set(
      USAGE_QUOTA_CACHE_STORAGE_KEY,
      JSON.stringify({ fiveHour: { remainingPct: 55, updatedAt: fresh - 1000 } }),
    );
    assert.equal(readUsageQuotaSnapshot(fresh).stale, false, "a fresh cache is not stale");

    // 3. Legacy fallback: usedPct converts to remaining = 100 - used.
    storage.delete(USAGE_QUOTA_CACHE_STORAGE_KEY);
    globalThis.window = { __daymarkUsage: () => ({ fiveHour: { usedPct: 30 }, sevenDay: { usedPct: 90 } }) };
    snapshot = readUsageQuotaSnapshot(fresh);
    assert.equal(snapshot.fiveHour.remainingPct, 70);
    assert.equal(snapshot.sevenDay.remainingPct, 10);
    assert.equal(snapshot.stale, false, "the legacy contract is never flagged stale");

    // Nothing available at all -> null, meters hide.
    globalThis.window = {};
    assert.equal(readUsageQuotaSnapshot(fresh), null);

    // Malformed quota payload falls through instead of crashing.
    storage.set(USAGE_QUOTA_CACHE_STORAGE_KEY, "{not json");
    globalThis.window = { __daymarkUsageQuota: () => ({ fiveHour: { remainingPct: "nope" } }) };
    assert.equal(readUsageQuotaSnapshot(fresh), null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousUsage === undefined) delete globalThis.window?.__daymarkUsage;
    else globalThis.window.__daymarkUsage = previousUsage;
    delete globalThis.localStorage;
  }

  // The meters component consumes the quota contract, stays first-class visible
  // in the Control Panel header, and formats remaining % with reset countdowns.
  assert.match(metersSource, /readUsageQuotaSnapshot/);
  assert.match(metersSource, /\{remaining\}% left/);
  assert.match(metersSource, /resets in/);
  assert.match(metersSource, /usage-meters--stale/);
  assert.match(app, /<UsageMeters \/>/);
});

test("every control board column has a per-column add-task composer wired to its stage", async () => {
  const [app, shellStyles] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8"),
  ]);

  const panelSource = app.slice(
    app.indexOf("function ControlBoardAddTask("),
    app.indexOf("function UtilityPanel("),
  );
  assert.ok(panelSource.length > 0, "ControlBoardAddTask must exist in App.jsx");
  assert.match(panelSource, /function ControlBoardAddTask\(/);
  assert.match(panelSource, /control-board__add-trigger/);
  assert.match(panelSource, /control-board__add-input/);
  assert.match(panelSource, /aria-label=\{`Add task to \$\{label\}`\}/);

  // One composer per column, each bound to its own workspace stage.
  assert.match(panelSource, /<ControlBoardAddTask defaultWorkspaceId=\{workspaces\[0\]\?\.id \?\? ''\} label="To do" onCreate=\{onComposerSubmit\} stage="todo" \/>/);
  assert.match(panelSource, /<ControlBoardAddTask defaultWorkspaceId=\{workspaces\[0\]\?\.id \?\? ''\} label="In Progress" onCreate=\{onComposerSubmit\} stage="inprogress" \/>/);
  assert.match(panelSource, /<ControlBoardAddTask defaultWorkspaceId=\{workspaces\[0\]\?\.id \?\? ''\} label="Finished" onCreate=\{onComposerSubmit\} stage="finished" \/>/);

  // The create flow reuses createControlSession with an explicit stage so a
  // task added under In Progress/Finished is born in that section.
  assert.match(app, /const createControlSession = \(title, workspaceId, priority, stage = 'todo'\) => \{/);
  assert.match(app, /ensureWorkspaceStageSection\(requestedProjectId, stage\)/);

  // The composer matches the vanta-black theme inputs.
  assert.match(shellStyles, /\.control-board__add-input \{[\s\S]*?background: var\(--canvas\);[\s\S]*?color: var\(--ink\);/);
});

test("control board surfaces keep the black vanta surface on hover", async () => {
  const shellStyles = await readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8");

  // Targeted guard: rows/cards stay on the dark surface token family on hover
  // (never a grey like #1f2937); only the border-color shifts subtly.
  assert.match(
    shellStyles,
    /\.control-panel \.control-board__row:hover,\s*\n\.control-panel \.control-card:hover \{\s*\n\s*background: var\(--color-surface, var\(--surface\)\) !important;\s*\n\s*background-color: var\(--color-surface, var\(--surface\)\) !important;\s*\n\s*border-color: rgba\(255, 255, 255, 0\.14\);\s*\n\}/,
  );
  assert.doesNotMatch(shellStyles, /\.control-board__row:hover[^{]*\{[^}]*#1f2937/);
  assert.doesNotMatch(shellStyles, /\.control-card:hover[^{]*\{[^}]*#1f2937/);
});

test("blanket hover guard is theme-agnostic and no grey hover fills remain", async () => {
  const shellStyles = await readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8");

  // Root cause: the runtime sets data-theme to the raw preference (default
  // "system"), so the old [data-theme="dark"] blanket guard never applied and
  // light-theme grey hover fills leaked through. The guard must now match any
  // theme attribute value.
  assert.match(shellStyles, /\[data-theme\] \.app-shell \*:hover/);
  assert.doesNotMatch(shellStyles, /\[data-theme="dark"\]/);

  // Light-theme hover/active fills must stay in the black family (white alpha
  // <= 0.14 over #050507 keeps the surface black), never mid-grey.
  const greyFill = /background(?:-color)?:\s*rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.(?:1[5-9]|[2-9]\d?)\s*\)/;
  const offenders = [...shellStyles.matchAll(/[^{}]+\{[^}]*\}/g)]
    .filter((rule) => greyFill.test(rule[0]) && !/scrollbar-thumb/.test(rule[0]));
  assert.equal(offenders.length, 0, `grey fills found: ${offenders.map((r) => r[0].slice(0, 120)).join(" | ")}`);
});

test("delete-all counts real failures, retries, agents order shows red confirmation, oversize attachments explain", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  // Delete-all must honor each delete's real result and retry the leftovers
  // instead of counting failures as deleted.
  const runDelete = app.slice(app.indexOf("const runFinishedDelete = async () => {"), app.indexOf("const armFinishedDelete = () => {"));
  assert.ok(runDelete.length > 0, "runFinishedDelete must exist");
  assert.match(runDelete, /if \(await onDelete\(session\)\) deleted\.add\(session\.id\)/);
  assert.match(runDelete, /for \(let pass = 0; pass < 3 && failed\.size; pass \+= 1\)/);
  assert.match(runDelete, /could not be deleted/);
  const deleteControl = app.slice(app.indexOf("const deleteControlTask = (session) => {"), app.indexOf("const createControlSession ="));
  assert.match(deleteControl, /return true/);
  assert.match(deleteControl, /return false/);

  // Agents: clicking Create must show an immediate red ORDERED N AGENTS confirmation.
  assert.match(app, /const \[agentsOrdered, setAgentsOrdered\] = useState\(null\)/);
  assert.match(app, /setAgentsOrdered\(count\)/);
  assert.match(app, /ORDERED \{agentsOrdered\} AGENTS/);
  assert.match(app, /data-agents-ordered=\{session\.id\}/);

  // Attachments: any file type accepted, oversized files get a clear reason.
  const attachmentsSource = app.slice(app.indexOf("function TaskAttachments("), app.indexOf("function AttachmentItem("));
  assert.match(attachmentsSource, /type="file" \/>/);
  assert.doesNotMatch(attachmentsSource, /accept=/);
  assert.match(attachmentsSource, /over 2\.4 MB were skipped/);

  // Red styling exists for the ordered confirmation.
  const shellStyles = await readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8");
  assert.match(shellStyles, /\.control-card__agents-ordered \{/);
});

test("To do Auto button toggles an X-minute force-start interval that turns it yellow and reverts to sequential", async () => {
  const [app, shellStyles] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles/app-shell.css", import.meta.url), "utf8"),
  ]);

  // Persisted interval setting + choices.
  assert.match(app, /daymark\.control-auto-interval-min/);
  assert.match(app, /const AUTO_INTERVAL_CHOICES = \[1, 2, 3, 5, 10, 15, 30\]/);
  assert.match(app, /function readAutoIntervalMinutes\(\)/);

  // Small button above the To do tasks; yellow styling while active; clicking
  // again reverts to the default sequential behavior.
  const autoUi = app.slice(app.indexOf('data-auto-interval-toggle') - 300, app.indexOf('data-auto-interval-toggle') + 1600);
  assert.ok(autoUi.length > 0, "the To do Auto button must render in the column heading");
  assert.match(autoUi, /data-auto-interval-toggle/);
  assert.match(autoUi, /is-interval/);
  assert.match(autoUi, /data-auto-interval-minutes/);
  assert.match(shellStyles, /\.board-column__auto-button\.is-interval \{[\s\S]*?background: #e0a92b;/);

  // Queue runner: interval mode force-starts the next queued session even
  // while the previous one is still running; sequential mode unchanged.
  // Both gates count EVERY already-running workspace session, so Auto
  // launches only N - K new sessions when K are already running.
  const runner = app.slice(app.indexOf("Sequential auto-run queue runner"), app.indexOf("const channel = typeof BroadcastChannel === 'undefined'"));
  assert.match(runner, /intervalMs > 0 \? alive\.find\(\(entry\) => !entry\.startedAt\) : alive\[0\]/);
  assert.match(runner, /const runningCount = Object\.values\(state\.tasks\)\.filter\(\(task\) =>/);
  assert.match(runner, /if \(!target \|\| \(intervalMs <= 0 && \(target\.startedAt \|\| anyRunning\)\)\) return/);
  assert.match(runner, /if \(intervalMs > 0 && runningCount >= alive\.length\) return/);
  assert.match(runner, /readAutoIntervalMinutes\(\) \* 60000/);
});
