import fs from "node:fs";
import path from "node:path";

const goal =
  ": Add project creation and a beautiful Upcoming calendar with year, month, and week navigation. Allow tasks to be added, moved, or edited on any day, marking days containing tasks in green. Perfect the UI, frontend, backend, functionality, and useful task-management features. Research current implementation ideas and route findings to the appropriate workers. Build and verify the application end to end. Finally compile, recompile, and launch it for me to see.";

const routes = Array.from({ length: 60 }, (_, index) => {
  const number = index + 1;
  const slot = `W${String(number).padStart(2, "0")}`;
  if (number <= 10) return { slot, model: "gpt-5.6-terra", effort: "high" };
  if (number <= 20) return { slot, model: "gpt-5.6-sol", effort: "low" };
  if (number <= 30) return { slot, model: "gpt-5.6-terra", effort: "low" };
  return { slot, model: "gpt-5.6-luna", effort: "xhigh" };
});

const specs = [
  ["Visual concept director", "execute", "Generate the complete high-fidelity Upcoming calendar and project-creation visual concept, then extract the design system.", "desktop concept image and design-system brief", "W09 application integration owner", [], ["design-concept-generation"], [".codex-team/artifacts/upcoming-calendar-concept.png", ".codex-team/artifacts/design-system.md"], []],
  ["Repository architecture mapper", "research", "Trace the live shell, store, date utilities, editor modules, styles, tests, and bypassed feature code into a low-risk integration map.", "architecture map with file-level seams and hazards", "W09 application integration owner", [], [], ["architecture-map.md"], []],
  ["Calendar domain architect", "research", "Define year, month, and week state, visible ranges, selected dates, task buckets, markers, and move semantics without UTC drift.", "calendar domain contract and transition table", "W21 calendar model implementer", [], [], ["calendar-domain-contract.md"], []],
  ["Project workflow architect", "research", "Specify project creation validation, color, description, default section, persistence, sidebar insertion, navigation, cancel, and conflict recovery.", "project workflow and data-flow specification", "W24 project dialog implementer", [], [], ["project-workflow-spec.md"], []],
  ["Task scheduling UX architect", "research", "Specify add, edit, drag, keyboard move, and reschedule flows from any calendar day while preserving task metadata.", "task scheduling interaction matrix", "W26 calendar task editor implementer", [], [], ["task-scheduling-ux.md"], []],
  ["Accessibility design lead", "research", "Define keyboard, focus, grid semantics, announcements, contrast, reduced-motion, and touch requirements for every new surface.", "accessibility implementation checklist", "W09 application integration owner", [], [], ["accessibility-design-checklist.md"], []],
  ["Performance strategy lead", "research", "Set render and interaction budgets for year grids, task bucketing, drag feedback, localStorage writes, and 1000-task workloads.", "performance budget and memoization strategy", "W09 application integration owner", [], [], ["performance-strategy.md"], []],
  ["Persistence and migration auditor", "research", "Audit revision conflicts, undo, migration, reload, and failure handling for project and calendar task mutations.", "persistence safeguard and regression-test report", "W21 calendar model implementer", [], [], ["persistence-risk-report.md"], []],
  ["Application integration owner", "integrate", "Integrate accepted commits and findings into the saved checkout and wire the complete project and Upcoming workflows into the live shell.", "integrated production application in the main checkout", "W10 end-to-end release verifier", ["src/App.jsx"], ["main-checkout-integration"], ["integrated-application"], ["W01", "W02", "W03", "W04", "W05", "W06", "W07", "W08", "W21", "W22", "W23", "W24", "W25", "W26", "W27", "W28", "W29", "W30"]],
  ["End-to-end release verifier", "verify", "Run fresh unit, build, browser, responsive, persistence, compile, recompile, and launch verification against the integrated checkout.", "release evidence pack with screenshots and live URL", "Coordinator", [], ["release-build-browser-launch"], ["release-evidence-pack"], ["W09", "W30"]],
  ["Current task-manager pattern researcher", "research", "Research current primary-source task-manager calendar patterns for scheduling, density, quick capture, and useful planning behavior.", "cited current-pattern brief with Daymark decisions", "W01 visual concept director", [], [], ["current-pattern-brief.md"], []],
  ["Calendar interaction standards researcher", "research", "Research current primary standards for keyboard calendar grids, date selection, drag alternatives, and accessible task movement.", "standards-backed calendar interaction brief", "W22 Upcoming calendar component implementer", [], [], ["calendar-interaction-standards.md"], []],
  ["Year view behavior researcher", "research", "Study current production year views for twelve-month scanability, task density, month selection, and accessible green presence markers.", "year-view behavior recommendation", "W22 Upcoming calendar component implementer", [], [], ["year-view-recommendation.md"], []],
  ["Month view behavior researcher", "research", "Study month-grid overflow, out-of-month dates, task chips, date creation, selection, and six-week layout patterns.", "month-view behavior recommendation", "W23 calendar visual system implementer", [], [], ["month-view-recommendation.md"], []],
  ["Week view behavior researcher", "research", "Study seven-day planning patterns, all-day tasks, time labels, cross-week moves, and mobile week collapse.", "week-view behavior recommendation", "W22 Upcoming calendar component implementer", [], [], ["week-view-recommendation.md"], []],
  ["Drag and drop technology researcher", "research", "Compare current React 19 compatible native and library drag approaches for accessibility, bundle cost, and keyboard fallback.", "drag-and-drop implementation decision memo", "W27 task movement model implementer", [], [], ["drag-drop-decision.md"], []],
  ["Project creation pattern researcher", "research", "Research modern project dialogs for essential fields, color swatches, validation, cancellation, and post-create navigation.", "project-dialog pattern brief", "W24 project dialog implementer", [], [], ["project-dialog-patterns.md"], []],
  ["Quick add and editor researcher", "research", "Research calendar-cell quick add and progressive task editing that preserves fast capture and date inheritance.", "quick-add and editor recommendation", "W26 calendar task editor implementer", [], [], ["quick-add-editor-patterns.md"], []],
  ["Task-day marker researcher", "research", "Define accessible green day-presence and density markers for selected, today, completed-only, dark, and color-deficient states.", "task-day marker system specification", "W23 calendar visual system implementer", [], [], ["task-day-marker-spec.md"], []],
  ["Responsive calendar researcher", "research", "Research desktop-first calendar layouts for laptop, tablet, and mobile without marketing-style composition or unstable grids.", "responsive calendar breakpoint recommendation", "W23 calendar visual system implementer", [], [], ["responsive-calendar-recommendation.md"], []],
  ["Calendar model implementer", "execute", "Implement pure year, month, and week range navigation, task bucketing, marker counts, selected dates, and date movement helpers with tests.", "tested calendar model commit", "W09 application integration owner", ["src/features/calendar/upcoming-model.ts", "src/features/calendar/upcoming-model.test.ts"], [], ["calendar-model-commit"], []],
  ["Upcoming calendar component implementer", "execute", "Build the accessible React Upcoming calendar with three modes, task chips, date selection, add/edit hooks, and movement callbacks.", "reusable UpcomingCalendar component commit", "W09 application integration owner", ["src/features/calendar/UpcomingCalendar.tsx"], [], ["upcoming-calendar-component-commit"], ["W03", "W12", "W13", "W14", "W15"]],
  ["Calendar visual system implementer", "execute", "Implement polished calendar styles for desktop, tablet, mobile, light, dark, stable grids, and green task-day states.", "responsive calendar stylesheet commit", "W09 application integration owner", ["src/features/calendar/upcoming-calendar.css"], [], ["calendar-style-commit"], ["W01", "W14", "W15", "W19", "W20"]],
  ["Project creation dialog implementer", "execute", "Build the accessible project dialog for name, description, color, default section, validation, save, cancel, and focus return.", "ProjectCreateDialog component commit", "W09 application integration owner", ["src/features/projects/ProjectCreateDialog.tsx"], [], ["project-dialog-component-commit"], ["W04", "W17"]],
  ["Project dialog styling implementer", "execute", "Implement restrained project dialog styling, swatches, errors, modal and mobile layouts, focus states, and dark theme.", "project dialog stylesheet commit", "W09 application integration owner", ["src/features/projects/project-create-dialog.css"], [], ["project-dialog-style-commit"], ["W01", "W17"]],
  ["Calendar task editor implementer", "execute", "Build calendar task create/edit adapters and UI for inherited date, title, description, project, priority, date, time, and safe store patches.", "calendar task editor and adapter test commit", "W09 application integration owner", ["src/features/calendar/CalendarTaskEditor.tsx", "src/features/calendar/calendar-task-adapters.ts", "src/features/calendar/calendar-task-adapters.test.ts"], [], ["calendar-task-editor-commit"], ["W05", "W18"]],
  ["Task movement model implementer", "execute", "Implement validated pointer payloads, keyboard move commands, date reassignment, metadata preservation, and invalid-drop handling with tests.", "task movement module and regression commit", "W09 application integration owner", ["src/features/calendar/task-movement.ts", "src/features/calendar/task-movement.test.ts"], [], ["task-movement-commit"], ["W05", "W16"]],
  ["Calendar task chip styling implementer", "execute", "Implement task chip, overflow, hover, drag, completed, priority, focus, and compact week-list styles.", "calendar task-chip stylesheet commit", "W09 application integration owner", ["src/features/calendar/calendar-task-chips.css"], [], ["calendar-task-chip-style-commit"], ["W19", "W20"]],
  ["Calendar toolbar implementer", "execute", "Build stable mode controls, previous, next, today, range label, and compact mobile calendar navigation.", "CalendarToolbar component commit", "W09 application integration owner", ["src/features/calendar/CalendarToolbar.tsx"], [], ["calendar-toolbar-commit"], ["W12", "W13", "W14", "W15"]],
  ["Build and documentation maintainer", "execute", "Update scripts and documentation for all tests, compile, recompile, launch, and accurate feature coverage.", "package and README verification commit", "W10 end-to-end release verifier", ["package.json", "README.md"], [], ["build-docs-commit"], []],
  ["Keyboard navigation verifier", "verify", "Verify keyboard operation across all calendar modes, date selection, project creation, task add, edit, and move.", "keyboard workflow acceptance report", "W10 end-to-end release verifier", [], ["keyboard-navigation-audit"], ["keyboard-navigation-report"], ["W09"]],
  ["Screen reader semantics verifier", "verify", "Audit landmarks, headings, grids, cells, task labels, live announcements, dialog names, and state attributes.", "screen-reader semantic evidence report", "W10 end-to-end release verifier", [], ["screen-reader-semantics-audit"], ["screen-reader-semantics-report"], ["W09"]],
  ["Color contrast verifier", "verify", "Measure green markers, text, borders, selection, today, focus, errors, and disabled contrast in light and dark themes.", "contrast ratio matrix", "W23 calendar visual system implementer", [], ["color-contrast-audit"], ["color-contrast-report"], ["W23"]],
  ["Mobile viewport verifier", "verify", "Test 390x844 sidebar, toolbar, calendar scrolling, dialogs, chips, touch targets, overlap, and clipping.", "mobile screenshot and overflow report", "W10 end-to-end release verifier", [], ["mobile-390-viewport-audit"], ["mobile-viewport-report"], ["W09"]],
  ["Tablet viewport verifier", "verify", "Test 768x1024 year, month, week, creation, editing, movement, sidebar, and modal layout.", "tablet screenshot and layout report", "W10 end-to-end release verifier", [], ["tablet-768-viewport-audit"], ["tablet-viewport-report"], ["W09"]],
  ["Laptop viewport verifier", "verify", "Test 1280x800 first-viewport fit, dense calendar usability, toolbar stability, and workflow reachability.", "laptop viewport usability report", "W10 end-to-end release verifier", [], ["laptop-1280-viewport-audit"], ["laptop-viewport-report"], ["W09"]],
  ["Dark theme verifier", "verify", "Exercise every calendar and project state in explicit and system dark themes for legibility and polish.", "dark-theme visual report", "W10 end-to-end release verifier", [], ["dark-theme-audit"], ["dark-theme-report"], ["W09"]],
  ["Project creation functional verifier", "verify", "Test success, cancel, validation, default section, color persistence, immediate sidebar insertion, navigation, and reload.", "project creation persisted-state report", "W10 end-to-end release verifier", [], ["project-creation-functional-audit"], ["project-creation-report"], ["W09"]],
  ["Task creation functional verifier", "verify", "Create tasks on empty and populated days in year, month, and week modes and verify inherited dates and projects.", "calendar task creation matrix", "W10 end-to-end release verifier", [], ["task-create-any-day-audit"], ["task-creation-report"], ["W09"]],
  ["Task editing functional verifier", "verify", "Edit title, description, project, priority, due date, and time from calendar chips and confirm cross-view persistence.", "task edit round-trip report", "W10 end-to-end release verifier", [], ["task-edit-roundtrip-audit"], ["task-edit-report"], ["W09"]],
  ["Task movement pointer verifier", "verify", "Move tasks by pointer across days, weeks, and months and verify exact persistent date mutation and invalid-drop safety.", "pointer movement evidence report", "W10 end-to-end release verifier", [], ["pointer-task-move-audit"], ["pointer-movement-report"], ["W09"]],
  ["Task movement keyboard verifier", "verify", "Move tasks using the non-drag keyboard or menu fallback and verify visible and announced confirmation.", "keyboard movement evidence report", "W10 end-to-end release verifier", [], ["keyboard-task-move-audit"], ["keyboard-movement-report"], ["W09"]],
  ["Year navigation boundary verifier", "verify", "Exercise previous, next, today, month selection, and year transitions across multiple years.", "year navigation transition matrix", "W21 calendar model implementer", [], ["year-navigation-boundary-audit"], ["year-navigation-report"], ["W21", "W22"]],
  ["Leap year date verifier", "verify", "Test February 28, February 29, March 1, task buckets, moves, and markers in leap and common years.", "leap-year regression report", "W21 calendar model implementer", [], ["leap-year-audit"], ["leap-year-report"], ["W21"]],
  ["Month grid geometry verifier", "verify", "Validate 42 cells, outside dates, week starts, six-row months, today, selection, and overflow counts.", "month-grid geometry report", "W22 Upcoming calendar component implementer", [], ["month-grid-geometry-audit"], ["month-grid-report"], ["W21", "W22"]],
  ["Week crossing verifier", "verify", "Verify seven-day rendering and navigation when weeks cross month and year boundaries, including task ordering and add actions.", "cross-boundary week report", "W22 Upcoming calendar component implementer", [], ["week-cross-boundary-audit"], ["week-crossing-report"], ["W21", "W22"]],
  ["Green marker semantics verifier", "verify", "Prove active task days are green and empty days are not across modes, counts, selection, today, completed-only, and dark states.", "green marker truth table and screenshots", "W23 calendar visual system implementer", [], ["green-marker-semantic-audit"], ["green-marker-report"], ["W23", "W09"]],
  ["Persistence reload verifier", "verify", "Create projects and calendar tasks, reload, change modes, and confirm state survives without reseeding or duplication.", "reload persistence checkpoints", "W10 end-to-end release verifier", [], ["reload-persistence-audit"], ["reload-persistence-report"], ["W09"]],
  ["Concurrent tab conflict verifier", "verify", "Simulate two tabs writing from one revision and prove stale project or calendar writes fail without silent overwrite.", "concurrent-write regression report", "W10 end-to-end release verifier", [], ["concurrent-tab-conflict-audit"], ["concurrent-conflict-report"], ["W09"]],
  ["Timezone and DST verifier", "verify", "Audit local-date and timed-task behavior around DST transitions and representative timezones for day-drift defects.", "timezone and DST correctness report", "W21 calendar model implementer", [], ["timezone-dst-audit"], ["timezone-dst-report"], ["W21"]],
  ["Recurrence preservation verifier", "verify", "Move and edit recurring tasks and verify recurrence is preserved unless deliberately changed.", "recurrence metadata report", "W26 calendar task editor implementer", [], ["recurrence-preservation-audit"], ["recurrence-report"], ["W26", "W27"]],
  ["Search regression verifier", "verify", "Confirm global search reflects created, edited, moved, completed, and project-changed calendar tasks.", "search regression report", "W10 end-to-end release verifier", [], ["search-regression-audit"], ["search-regression-report"], ["W09"]],
  ["Command palette regression verifier", "verify", "Exercise command navigation, Upcoming routing, quick add, and existing shortcuts after integration.", "command and shortcut regression report", "W10 end-to-end release verifier", [], ["command-palette-regression-audit"], ["command-palette-report"], ["W09"]],
  ["Sidebar count verifier", "verify", "Audit Today, Inbox, Upcoming, project, and label counts after create, edit, move, complete, and reload.", "navigation count consistency report", "W09 application integration owner", [], ["sidebar-count-consistency-audit"], ["sidebar-count-report"], ["W09"]],
  ["Empty state verifier", "verify", "Inspect empty calendar modes, projects, and selected days for accurate copy, stable layout, and useful create actions.", "empty-state usability report", "W01 visual concept director", [], ["empty-state-usability-audit"], ["empty-state-report"], ["W09"]],
  ["Large dataset performance verifier", "verify", "Measure render, mode switching, navigation, selection, and editing with a representative 1000-task dataset.", "performance timings and profiler report", "W07 performance strategy lead", [], ["large-dataset-performance-audit"], ["performance-measurements"], ["W09"]],
  ["Build integrity verifier", "verify", "Run dependency integrity, source compilation, production build, emitted asset resolution, and clean-output checks.", "fresh build-integrity command report", "W10 end-to-end release verifier", [], ["build-integrity-audit"], ["build-integrity-report"], ["W09", "W30"]],
  ["Unit suite verifier", "verify", "Run every existing and new unit test and prove the command includes all calendar model, adapter, and movement tests.", "unit-suite coverage and result report", "W10 end-to-end release verifier", [], ["unit-suite-audit"], ["unit-suite-report"], ["W21", "W26", "W27", "W30"]],
  ["Launch smoke verifier", "verify", "Launch the final Vite app on an available localhost port, verify HTTP and rendered UI, and keep it available for the user.", "live launch receipt with URL and process identity", "Coordinator", [], ["live-app-launch-smoke"], ["live-launch-receipt"], ["W10"]],
  ["Final acceptance auditor", "integrate", "Map every immutable goal clause to current-invocation evidence, reject gaps, and prepare receipt-ready outcomes without source changes.", "complete acceptance matrix and outcome-ledger content", "Coordinator", [], ["final-acceptance-ledger-audit"], ["final-acceptance-matrix"], ["W10", "W31", "W32", "W33", "W34", "W35", "W36", "W37", "W38", "W39", "W40", "W41", "W42", "W43", "W44", "W45", "W46", "W47", "W48", "W49", "W50", "W51", "W52", "W53", "W54", "W55", "W56", "W57", "W58", "W59"]],
];

if (specs.length !== 60) throw new Error(`Expected 60 specs, found ${specs.length}`);

const workers = specs.map((spec, index) => {
  const [jobTitle, workMode, focus, output, consumer, writeTargets, actionTargets, ownedOutputs, dependencies] = spec;
  const route = routes[index];
  const slug = jobTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    slot: route.slot,
    criterion_id: `criterion-${route.slot.toLowerCase()}-${slug}`,
    contribution_id: `contribution-${route.slot.toLowerCase()}-${slug}`,
    job_title: jobTitle,
    model: route.model,
    effort: route.effort,
    work_mode: workMode,
    assignment: `Own the ${jobTitle} contribution. ${focus}`,
    deliverable: `Produce the ${output}, with concrete evidence and a concise handoff to ${consumer}.`,
    consumer,
    goal_link: `This contribution advances the immutable Daymark goal through the distinct ${slug} acceptance boundary.`,
    read_scope: "F:\\study\\WebBuilding\\projects\\daymark-desktop and only accepted worker reports relevant to this contribution",
    write_targets: writeTargets,
    action_targets: actionTargets,
    owned_outputs: ownedOutputs,
    exclusions: [
      "Do not modify or act on any target outside this contribution",
      "Do not overlap another worker owned target",
      "Do not claim global completion",
    ],
    dependencies,
    acceptance_test: `Acceptance passes only when the ${slug} deliverable proves its stated focus with reproducible evidence and no ownership overlap.`,
  };
});

const plan = {
  team_id: "team-73d69b1e-8b432d19",
  invocation_id: "8b432d19-b1d1-45a6-b227-efdf2be278ce",
  started_at: "2026-08-02T15:37:48.129Z",
  coordinator_thread_id: "019fc316-acef-7431-9a8e-051fe405a6e0",
  workspace: "F:\\study\\WebBuilding\\projects\\daymark-desktop",
  workspace_id: "ws-73d69b1ebc1ed0f3",
  project_id: "3e384933-5a5f-45b1-b7ff-3cd7807e2ba3",
  goal_mode: "execution",
  coordinator_role: "orchestration-only",
  goal,
  requested_count: 60,
  requested_routes: routes,
  worktree_preflight: {
    ready: true,
    code: "worktree_base_ready",
    head: "d09f77c882ca83419fd7a4033c666dea9ae790d0",
  },
  workers,
};

const outputPath = path.resolve(".codex-team/team-plan.json");
fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(outputPath);
