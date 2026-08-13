import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
const taskEditor = await readFile(
  new URL('./features/task-editor/TaskEditor.tsx', import.meta.url),
  'utf8',
)
const orderWorkspace = await readFile(
  new URL('./features/order/OrderWorkspace.jsx', import.meta.url),
  'utf8',
)
const orderStyles = await readFile(
  new URL('./features/order/order.css', import.meta.url),
  'utf8',
)
const styles = await readFile(new URL('./styles/app-shell.css', import.meta.url), 'utf8')
const main = await readFile(new URL('./main.jsx', import.meta.url), 'utf8')
const smoothWheel = await readFile(new URL('./core/smooth-wheel.ts', import.meta.url), 'utf8')

test('global shell exposes the required settings and repository affordances', () => {
  assert.match(app, /SettingsPanel/)
  assert.match(app, /aria-label="Open Daymark on GitHub"/)
  assert.match(app, /https:\/\/github\.com\/Michaelunkai\/daymark-desktop/)
  assert.match(app, /onImport={importBackup}/)
  assert.match(app, /onReset={resetWorkspace}/)
  assert.match(app, /route === 'notes' \|\| route === 'diary'/)
  assert.match(app, /onTaskToggle={toggleTask}/)
  assert.match(app, /createLongPressReorderController/)
  assert.match(app, /onPointerDown=/)
  assert.match(app, /reorder-mode-help/)
  assert.match(app, /Nothing was changed\./)
  assert.match(app, /window\.DaymarkAI/)
  assert.match(app, /AGENT_BRIDGE_VERSION = 3/)
  assert.match(app, /BroadcastChannel\('daymark-agent'\)/)
  assert.match(app, /daymark:agent-request/)
  assert.match(app, /operation === 'createTask'/)
  assert.match(app, /operation === 'startSession'/)
  assert.match(app, /listSessions/)
  assert.match(app, /getViewState/)
  assert.match(app, /'section\.remove'/)
  assert.match(app, /data-agent-bridge="connected"/)
  assert.match(app, /AI access needs key/)
  assert.match(app, /Device sync:/)
  assert.match(app, /Pair this browser/)
  assert.match(app, /pairSyncKey/)
  assert.match(app, /sidebar__sync--\$\{syncStatus\}/)
  assert.match(app, /const mainContentRef = useRef\(null\)/)
  assert.match(app, /mainContentRef\.current\.scrollTop = 0/)
  assert.match(app, /mainContentRef\.current\.scrollLeft = 0/)
  assert.match(app, /<main className="main-content" ref=\{mainContentRef\}>/)
  assert.doesNotMatch(app, /window\.scrollTo\(0, 0\)/)
  assert.doesNotMatch(app, /LOCAL SHELL 0\.1/)
  assert.doesNotMatch(app, />Agent connected</)
  assert.match(app, /sectionComposerOpen/)
  assert.match(app, /data-section-reorder-id/)
  assert.match(app, /data-section-drop-id/)
  assert.match(app, /targetSectionId/)
  assert.match(app, /project\?\.description\?\.trim\(\)/)
  assert.match(app, /type: 'section\.add'/)
  assert.match(app, /sectionId: section\.id \?\? null/)
  assert.match(app, /aria-label=\{`Add task to \$\{section\.name\}`\}/)
  assert.match(app, /className="icon-button section-add-task-button"/)
  assert.match(app, /title="Add task to section"/)
  assert.match(app, /sectionId: targetSectionId/)
  assert.match(app, /onAddTask=\{\(\) => openTaskEditor\('create', null, null, section\.id\)\}/)
  assert.match(app, /function ConfirmationDialog/)
  assert.match(app, /const requestConfirmation =/)
  assert.match(app, /onMoveTask=\{moveTaskFromEditor\}/)
  assert.match(app, /onCopyTask=\{copyTaskFromEditor\}/)
  assert.match(app, /onMoveTaskToOrder=\{moveTaskToOrder\}/)
  assert.match(app, /onCopyTaskToOrder=\{copyTaskToOrder\}/)
  assert.match(app, /onMoveToTask=\{moveOrderItemToTask\}/)
  assert.match(app, /onCopyToTask=\{copyOrderItemToTask\}/)
  assert.match(
    app,
    /taskId: taskEditor\.taskId,[\s\S]*?completedAt: null,[\s\S]*?completionContext: null/,
  )
  assert.match(app, /type: 'task\.transferToOrder'/)
  assert.match(app, /type: 'order\.transferToTask'/)
  assert.equal(
    [...app.matchAll(/setSearchTerm\(''\)/g)].length >= 5,
    true,
    'successful transfers must clear stale global search filters',
  )
  assert.doesNotMatch(app, /actionLabel: 'Delete note'/)
  assert.doesNotMatch(app, /actionLabel: 'Delete section'/)
  assert.doesNotMatch(app, /actionLabel: 'Delete project'/)
  assert.doesNotMatch(app, /actionLabel: 'Delete from Order'/)
  assert.match(app, /type: 'order\.complete'/)
  assert.match(app, /name: 'Recently completed'/)
  assert.match(app, /sortCompletedHistoryNewestFirst\(tasks\.filter\(\(task\) => task\.completed\)\)/)
  assert.match(app, /if \(route === 'completed'\) \{\s*return \[\{\s*id: 'completed-history'/)
  assert.match(app, /Revoke Daymark AI key\?/)
  assert.match(app, /Replace current workspace\?/)
  assert.match(app, /Reset local workspace\?/)
  assert.doesNotMatch(app, /window\.confirm/)
  assert.doesNotMatch(app, /maxLength\s*=/)
})

test('task and Order layouts reserve readable width for complete titles and details', () => {
  assert.match(
    styles,
    /\.task-row \{[\s\S]*?grid-template-columns: 32px minmax\(0, 1fr\);/,
  )
  assert.match(
    styles,
    /\.task-row__details \{[\s\S]*?grid-column: 2;[\s\S]*?flex-wrap: wrap;/,
  )
  assert.match(
    styles,
    /\.task-note \{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/,
  )
  assert.match(
    orderStyles,
    /\.order-lanes \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  )
  assert.match(
    styles,
    /\.content-frame--order \{[\s\S]*?width: 100%;[\s\S]*?padding-inline: 32px;/,
  )
  assert.match(
    orderStyles,
    /\.order-lane--after \.order-lane__header \{[\s\S]*?border-top-color: var\(--amber\);/,
  )
  assert.match(
    orderStyles,
    /\.order-item \{[\s\S]*?grid-template-columns: 34px minmax\(0, 1fr\);/,
  )
  assert.match(
    orderStyles,
    /\.order-item__title \{[\s\S]*?font-size: 15px;[\s\S]*?line-height: 1\.35;/,
  )
  assert.match(
    orderStyles,
    /\.order-item__body p \{[\s\S]*?font-size: 13px;[\s\S]*?line-height: 1\.55;/,
  )
  assert.match(
    orderStyles,
    /\.order-item__actions \{[\s\S]*?grid-column: 1 \/ -1;/,
  )
  assert.match(
    orderStyles,
    /\.order-item__actions button \{[\s\S]*?min-height: 34px;/,
  )
  assert.match(
    orderStyles,
    /\.order-item__details \{[\s\S]*?white-space: pre-wrap;/,
  )
})

test('Order restores After as a first-class readable section', () => {
  assert.match(orderWorkspace, /\{ id: 'after', label: 'After'/)
  assert.match(orderWorkspace, /className={`order-lane order-lane--\$\{lane\.id\}`}/)
  assert.match(orderWorkspace, /onClick=\{\(\) => onAdd\(lane\.id\)\}/)
  assert.match(orderWorkspace, /onAdd=\{openCreate\}/)
  assert.match(orderWorkspace, /\{grouped\.map\(\(lane\) => \(/)
  assert.doesNotMatch(orderWorkspace, /order-lanes__secondary/)
  assert.doesNotMatch(orderWorkspace, /grouped\.slice\(1\)/)
  assert.match(orderStyles, /\.order-lane-nav \{[\s\S]*?display: grid;/)
  assert.match(
    orderStyles,
    /@media \(max-width: 1280px\) \{[\s\S]*?\.order-lanes \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
  )
})

test('shared workspace typography remains readable across every route', () => {
  assert.match(app, /className={`content-frame content-frame--\$\{route === 'order' \? 'order' : 'standard'\}`}/)
  assert.match(styles, /\.sidebar-row__label \{[\s\S]*?font-size: 14px;/)
  assert.match(styles, /\.task-section__heading \{[\s\S]*?font-size: 13px;/)
  assert.match(styles, /\.task-row__title \{[\s\S]*?font-size: 14px;/)
  assert.match(styles, /\.task-row__meta \{[\s\S]*?font-size: 11px;/)
  assert.match(styles, /\.task-row__details \{[\s\S]*?font-size: 11px;/)
  assert.match(styles, /\.note-list-item strong \{[\s\S]*?font-size: 14px;/)
  assert.match(styles, /\.note-list-item span \{[\s\S]*?font-size: 12px;/)
})

test('Order transfers expose Today and any explicit calendar date', () => {
  assert.match(orderWorkspace, /Schedule destination/)
  assert.match(orderWorkspace, />Today</)
  assert.match(orderWorkspace, />Tomorrow</)
  assert.match(orderWorkspace, />No date</)
  assert.match(orderWorkspace, /placeholder="e\.g\. today or 2026-12-31"/)
})

test('every Order lane exposes direct move and copy calendar actions', () => {
  assert.match(orderWorkspace, /const grouped = LANES\.map/)
  assert.match(orderWorkspace, /items: orderedItems\.filter\(\(item\) => item\.lane === lane\.id\)/)
  assert.match(orderWorkspace, /setDateTransferAction\('move'\)/)
  assert.match(orderWorkspace, /setDateTransferAction\('copy'\)/)
  assert.match(orderWorkspace, />Move to date</)
  assert.match(orderWorkspace, />Copy to date</)
  assert.match(orderWorkspace, /<DatePicker/)
  assert.match(orderWorkspace, /onChange=\{transferOrderItemToDate\}/)
  assert.match(
    orderWorkspace,
    /taskProjectId: null,[\s\S]*?taskSectionId: null,[\s\S]*?taskDueText: date/,
  )
  assert.match(orderStyles, /\.order-editor--date-transfer/)
  assert.match(orderStyles, /\.order-editor__calendar-transfer \.date-picker__day \{[\s\S]*?height: 48px;/)
  assert.match(orderStyles, /\.order-editor \{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/)
})

test('shell styles include keyboard focus, mobile layout, and dark theme coverage', () => {
  assert.match(styles, /button:focus-visible/)
  assert.match(styles, /\[data-theme="dark"\]/)
  assert.match(styles, /@media \(max-width: 720px\)/)
  assert.match(styles, /\.settings-grid/)
  assert.match(styles, /\.visually-hidden/)
  assert.match(styles, /\.journal-view/)
  assert.match(styles, /\.task-order-button/)
  assert.match(styles, /\.section-composer/)
  assert.match(styles, /\.section-order-button/)
  assert.match(styles, /\.section-add-task-button/)
  assert.match(styles, /background:\s*#d94f45/)
  assert.match(styles, /\.is-reordering/)
  assert.match(styles, /\.agent-connection/)
  assert.match(styles, /\.sidebar__sync--synced/)
  assert.match(styles, /\.app-shell\.sidebar-is-collapsed \.topbar/)
  assert.match(styles, /\.app-shell\.sidebar-is-collapsed \.topbar__brand > :not\(\.topbar__menu\)/)
  assert.match(styles, /\.main-content \{\s*grid-column: 1 \/ -1;/)
  assert.match(styles, /grid-template-columns: repeat\(4, minmax\(34px, 1fr\)\)/)
  assert.match(styles, /grid-template-rows: 44px 34px/)
  assert.match(styles, /\.global-search \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 1;/)
  assert.match(styles, /\.topbar__controls \.agent-connection \{[\s\S]*?font-size: 0;/)
  assert.match(styles, /\.topbar__controls \.topbar__divider \{[\s\S]*?display: none;/)
  assert.match(styles, /\.main-content \{[\s\S]*?scroll-behavior: smooth;/)
  assert.match(styles, /\.sidebar \{[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/)
  assert.match(styles, /\.shell-grid \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\);/)
  assert.match(styles, /\.sidebar__scroll \{[\s\S]*?scrollbar-gutter: stable;/)
  assert.match(styles, /\.sidebar__scroll \{[\s\S]*?scrollbar-color: #74827f #111615;/)
  assert.match(styles, /\.sidebar__scroll::\-webkit-scrollbar \{[\s\S]*?width: 12px;/)
  assert.match(styles, /\.sidebar__scroll::\-webkit-scrollbar-thumb \{[\s\S]*?min-height: 52px;/)
  assert.match(styles, /\.view-header \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(styles, /\.view-header__actions \{[\s\S]*?flex-wrap: wrap;[\s\S]*?max-width: 100%;/)
  assert.match(styles, /@media \(max-width: 1040px\) \{[\s\S]*?\.utility-panel \{[\s\S]*?display: none;/)
})

test('coarse mouse wheels are smoothed without replacing precise or accessible scrolling', () => {
  assert.equal([...main.matchAll(/installSmoothWheelScrolling\(\)/g)].length, 1)
  assert.match(smoothWheel, /passive: false/)
  assert.match(smoothWheel, /prefers-reduced-motion: reduce/)
  assert.match(smoothWheel, /isDiscreteMouseWheel/)
  assert.match(smoothWheel, /findScrollTarget\(path, "x", deltaY\)/)
  assert.match(smoothWheel, /daymark-smooth-wheel-active/)
  assert.match(smoothWheel, /findVisibleSidebarFallback/)
  assert.match(smoothWheel, /\.sidebar__scroll/)
  assert.match(smoothWheel, /NEAR_EMPTY_MAIN_SCROLL_LIMIT = 320/)
  assert.match(styles, /\.daymark-smooth-wheel-active \{[\s\S]*?scroll-behavior: auto !important;/)
})

test('transfer selects capture WebView values before scheduling state updates', () => {
  assert.match(taskEditor, /const orderLane = event\.currentTarget\.value;/)
  assert.doesNotMatch(taskEditor, /After which Order item\?/)
  assert.doesNotMatch(taskEditor, /Choose an Order item/)
  assert.doesNotMatch(taskEditor, /const orderRelationId =/)
  assert.match(taskEditor, /const projectId = event\.currentTarget\.value;/)
  assert.match(taskEditor, /const sectionId = event\.currentTarget\.value;/)
  assert.doesNotMatch(
    taskEditor,
    /setTransferTarget\(\(current\) => \(\{[\s\S]{0,240}event\.currentTarget\.value/,
  )
  assert.match(taskEditor, /const \[transferReady, setTransferReady\] = useState\(false\);/)
  assert.match(taskEditor, /function armTransferAction\(\)/)
  assert.match(taskEditor, /disabled=\{isSaving \|\| !transferReady\}/)
})

test('every task editor exposes direct calendar move and copy actions', () => {
  assert.match(taskEditor, /startTransfer\('moveToDate'\)/)
  assert.match(taskEditor, /startTransfer\('copyToDate'\)/)
  assert.match(taskEditor, /<DatePicker/)
  assert.match(taskEditor, /onChange=\{\(date\) => finishDateTransfer\(date\)\}/)
  assert.match(taskEditor, /task-editor__surface--date-transfer/)
})
