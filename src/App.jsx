import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { addDays, addMonths, addYears, fromLocalDate, startOfMonth, startOfWeek, toLocalDate } from './core/dates'
import { createId } from './core/sample-data'
import { createAppStore } from './core/store'
import { createBrowserStorage, loadState } from './core/storage'
import {
  createSyncChannel,
  getAndroidSyncLink,
  getSyncKey,
  getSyncLink,
  mergeSyncStates,
  pullSyncState,
  pushSyncState,
} from './core/sync'
import { clearLegacyJournal, readLegacyJournal } from './features/journal/model'
import { UpcomingCalendar as IntegratedUpcomingCalendar } from './features/calendar/UpcomingCalendar'
import { moveTaskToDate as buildMovedTask } from './features/calendar/task-movement'
import './features/calendar/upcoming-calendar.css'
import './features/calendar/calendar-task-chips.css'
import { ProjectCreateDialog } from './features/projects/ProjectCreateDialog'
import './features/projects/project-create-dialog.css'
import { OrderWorkspace } from './features/order/OrderWorkspace'
import { createLongPressReorderController } from './features/reorder/long-press.js'
import {
  createLocalThoughtCaptureStore,
  discardCapture,
  dismissCapture,
  getCaptureInteractionAction,
  openCapture,
  submitCapture,
  updateCaptureDraft,
} from './features/capture'
import {
  TaskEditor,
  createTaskEditorDraft,
  taskEditorDraftToTaskInput,
  taskEditorDraftToTaskPatch,
  taskToTaskEditorDraft,
  toTaskEditorLabelOptions,
  toTaskEditorProjectOptions,
  toTaskEditorSectionOptions,
} from './features/task-editor'
import { useTheme } from './styles/theme'

const NAV_ITEMS = [
  { id: 'today', label: 'Today', icon: 'sun', count: 5 },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', count: 4 },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar', count: 7 },
  { id: 'completed', label: 'Completed', icon: 'check', count: 0 },
  { id: 'order', label: 'Order', icon: 'list', count: 0 },
  { id: 'notes', label: 'Notes', icon: 'note', count: 0 },
  { id: 'diary', label: 'Diary', icon: 'note', count: 0 },
]

const PROJECT_COLORS = {
  'project-work': 'teal',
  'project-home': 'amber',
  'project-learning': 'indigo',
  'project-personal': 'teal',
  'project-inbox': 'teal',
  charcoal: 'teal',
  teal: 'teal',
  amber: 'amber',
  indigo: 'indigo',
  blue: 'indigo',
}

const TAGS = [
  { id: 'label:label-focus', label: 'Focus', count: 5 },
  { id: 'label:label-waiting', label: 'Waiting', count: 2 },
  { id: 'label:label-someday', label: 'Someday', count: 6 },
]

const GITHUB_URL = 'https://github.com/Michaelunkai/daymark-desktop'
const UI_SETTINGS_KEY = 'daymark.ui-settings'
const AGENT_BRIDGE_VERSION = 1
const DEFAULT_UI_SETTINGS = {
  density: 'comfortable',
  textScale: 'default',
  weekStartsOn: 'monday',
}

const appStore = createAppStore(createBrowserStorage())
const thoughtCaptureStore = createLocalThoughtCaptureStore(getBrowserStorage())

function getBrowserStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function notifyAndroidBackHandled(atRoot) {
  try {
    window.DaymarkAndroid?.onBackHandled?.(Boolean(atRoot))
  } catch {
    // The native bridge is optional when Daymark runs in a browser.
  }
}

function canUseBrowserStorage() {
  const storage = getBrowserStorage()
  if (!storage) return false
  const probeKey = 'daymark.storage-probe'
  try {
    storage.setItem(probeKey, 'ok')
    storage.removeItem(probeKey)
    return true
  } catch {
    return false
  }
}

function readUiSettings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UI_SETTINGS_KEY) ?? '{}')
    return {
      ...DEFAULT_UI_SETTINGS,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    }
  } catch {
    return { ...DEFAULT_UI_SETTINGS }
  }
}

function writeUiSettings(settings) {
  try {
    window.localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Preferences remain usable for the current session when storage is unavailable.
  }
}

function useAppState() {
  return useSyncExternalStore(appStore.subscribe, appStore.getState, appStore.getState)
}

function makeDue(date, time = null) {
  return { date, time, timezone: null, recurrence: null }
}

function seedDemoWorkspace() {
  const current = appStore.getState()
  const hasOnlySampleState =
    Object.keys(current.tasks).length === 1 &&
    Boolean(current.tasks['task-welcome']) &&
    Object.keys(current.projects).length === 2

  if (!hasOnlySampleState || current.preferences.onboardingDismissed) return

  const today = toLocalDate(new Date())
  const demoProjects = [
    { id: 'project-work', name: 'Launch week', color: 'teal' },
    { id: 'project-home', name: 'Home reset', color: 'amber' },
    { id: 'project-learning', name: 'Learning path', color: 'indigo' },
  ]
  const demoSections = [
    { id: 'section-focus', projectId: 'project-work', name: 'Focus lane' },
    { id: 'section-home', projectId: 'project-home', name: 'Other tasks' },
    { id: 'section-learning', projectId: 'project-learning', name: 'Other tasks' },
  ]
  const demoLabels = [
    { id: 'label-waiting', name: 'Waiting', color: 'amber' },
    { id: 'label-someday', name: 'Someday', color: 'indigo' },
  ]

  demoProjects.forEach((project, index) => {
    appStore.dispatch({
      type: 'project.add',
      input: { ...project, order: index + 2, isFavorite: index === 0 },
    })
  })
  demoSections.forEach((section, index) => {
    appStore.dispatch({ type: 'section.add', input: { ...section, order: index } })
  })
  demoLabels.forEach((label, index) => {
    appStore.dispatch({ type: 'label.add', input: { ...label, order: index + 2 } })
  })

  const demoTasks = [
    ['task-report', 'Finish the quarterly report', 'project-work', 'section-focus', 'label-focus', today, '10:00', 2, 'Summarize the latest numbers and add the final recommendation.'],
    ['task-updates', 'Send design team updates', 'project-work', 'section-focus', 'label-focus', today, '11:30', 4, 'Share the revised milestones and ask for open questions.'],
    ['task-marcus', 'Call with Marcus', 'project-work', 'section-focus', 'label-waiting', today, '13:30', 4, 'Confirm the handoff plan for the next release.'],
    ['task-groceries', 'Buy groceries', 'project-home', 'section-home', 'label-someday', today, null, 4, 'Fruit, greens, coffee, and something easy for dinner.'],
    ['task-prd', 'Review the PRD draft', 'project-work', 'section-focus', 'label-focus', addDays(today, 1), null, 4, 'Leave comments on the scope and first-run experience.'],
    ['task-chapter', 'Read chapter four', 'project-learning', 'section-learning', 'label-someday', addDays(today, 1), null, 4, 'Capture three ideas to try in the next study session.'],
    ['task-hike', 'Plan weekend hike', 'project-home', 'section-home', 'label-someday', addDays(today, 7), null, 3, 'Pick a route and check the weather before Friday.'],
  ]

  demoTasks.forEach(([id, content, projectId, sectionId, labelId, date, time, priority, description], index) => {
    appStore.dispatch({
      type: 'task.add',
      input: {
        id,
        content,
        description,
        projectId,
        sectionId,
        labelIds: [labelId],
        priority,
        due: makeDue(date, time),
        order: index,
      },
    })
  })
  appStore.dispatch({ type: 'preferences.update', patch: { onboardingDismissed: true } })
}

function formatTime(value) {
  const [hour, minute] = value.split(':').map(Number)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const normalizedHour = hour % 12 || 12
  return `${normalizedHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

function toViewTask(task, state) {
  const project = state.projects[task.projectId]
  const label = task.labelIds.map((labelId) => state.labels[labelId]).find(Boolean)
  const date = task.due?.date
  const today = toLocalDate(new Date())
  const dueTone = date === today ? 'teal' : date && date < today ? 'coral' : date ? 'indigo' : 'muted'
  const due = date
    ? `${date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`))}${task.due?.time ? `, ${formatTime(task.due.time)}` : ''}`
    : 'Unscheduled'

  return {
    id: task.id,
    title: task.content,
    section: state.sections[task.sectionId]?.name ?? 'Other tasks',
    project: task.projectId,
    projectName: project?.name ?? 'Inbox',
    projectColor: PROJECT_COLORS[project?.color] ?? 'teal',
    tag: label?.id ?? '',
    tagName: label?.name ?? '',
    due,
    dueTone,
    priority: task.priority === 1 ? 'Urgent' : task.priority === 2 ? 'High' : task.priority === 3 ? 'Low' : 'Normal',
    priorityTone: task.priority === 1 || task.priority === 2 ? 'coral' : 'ink',
    note: task.description || 'No description yet.',
    completed: Boolean(task.completedAt),
  }
}

const ICONS = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 5.5h16l1.2 10.1a2 2 0 0 1-2 2.4H4.8a2 2 0 0 1-2-2.4L4 5.5Z" />
      <path d="M3.4 13.2h4l1.2 2h6.8l1.2-2h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M7 3v4M17 3v4M3.5 9h17M7.5 12.5h.01M12 12.5h.01M16.5 12.5h.01M7.5 16h.01M12 16h.01" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 6.5a2 2 0 0 1 2-2h4l1.8 2h7.2a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V6.5Z" />
      <path d="M2.5 9h18" />
    </>
  ),
  tag: (
    <>
      <path d="m4 4 7.2-.5 8.8 8.8a2.3 2.3 0 0 1 0 3.3l-3.4 3.4a2.3 2.3 0 0 1-3.3 0L4.5 10.2 4 4Z" />
      <circle cx="8" cy="8" r="1.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.6V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.6-1H6v-2.6h.4A1.7 1.7 0 0 0 8 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2H15V5a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v2.6H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m16 16 4.2 4.2" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="7.5" />,
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  command: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 8h8M8 12h5M8 16h8" />
    </>
  ),
  chevronDown: <path d="m6.5 9 5.5 5.5L17.5 9" />,
  chevronUp: <path d="m6.5 15 5.5-5.5 5.5 5.5" />,
  arrowUp: <path d="m12 19V5m0 0L6.5 10.5M12 5l5.5 5.5" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ),
  board: (
    <>
      <rect x="4" y="4" width="5" height="16" rx="1" />
      <rect x="11" y="4" width="5" height="10" rx="1" />
      <rect x="18" y="4" width="2" height="13" rx="1" />
    </>
  ),
  focus: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2" />
    </>
  ),
  filter: (
    <>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  note: (
    <>
      <path d="M6 3.5h9l3 3v14H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M14.5 3.5V7H18M8 11h8M8 15h6" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8 12 2.6 2.6L16.5 9" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  github: (
    <>
      <path d="M15 22v-3.2c0-1.1-.4-1.9-1.1-2.3 3.6-.4 5.6-2.1 5.6-5.8 0-1.3-.5-2.4-1.3-3.3.1-.4.5-1.9-.2-3.2 0 0-1.1-.4-3.4 1.3a11.5 11.5 0 0 0-6.2 0C6.1 3.8 5 4.2 5 4.2c-.7 1.3-.3 2.8-.2 3.2-.8.9-1.3 2-1.3 3.3 0 3.7 2 5.4 5.6 5.8-.7.4-1.1 1.1-1.1 2.3V22" />
      <path d="M8.3 18.2c-2.5 1.1-2.5-1.1-3.5-1.4M17.7 18.2c2.5 1.1 2.5-1.1 3.5-1.4" />
    </>
  ),
}

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {ICONS[name] ?? ICONS.command}
    </svg>
  )
}

function LogoMark() {
  return (
    <span aria-hidden="true" className="brand-mark">
      <span />
      <span />
      <span />
    </span>
  )
}

function SidebarSection({ title, children, action, className = '' }) {
  return (
    <section className={`sidebar-section ${className}`}>
      <div className="sidebar-section__heading">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

function SidebarRow({ active, count, icon, label, onClick, color, shortcut }) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={`sidebar-row ${active ? 'is-active' : ''}`}
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      type="button"
    >
      {color ? <span className={`project-dot project-dot--${color}`} /> : <Icon name={icon} size={17} />}
      <span className="sidebar-row__label">{label}</span>
      {shortcut ? <span className="sidebar-row__shortcut">{shortcut}</span> : null}
      {count !== undefined ? <span className="sidebar-row__count">{count}</span> : null}
    </button>
  )
}

function ProjectSidebarItem({
  active,
  canMoveEarlier,
  canMoveLater,
  isReordering,
  count,
  onClick,
  onCancelReorder,
  onDelete,
  onEdit,
  onLongPressReorder,
  onReorderMove,
  onReorderEnd,
  onMoveEarlier,
  onMoveLater,
  project,
}) {
  const callbacksRef = useRef({ onLongPressReorder, onReorderEnd, onReorderMove, projectId: project.id })
  callbacksRef.current = { onLongPressReorder, onReorderEnd, onReorderMove, projectId: project.id }
  const reorderControllerRef = useRef(null)
  if (!reorderControllerRef.current) {
    reorderControllerRef.current = createLongPressReorderController({
      onLongPress: () => callbacksRef.current.onLongPressReorder?.(callbacksRef.current.projectId),
      onDragMove: (event) => callbacksRef.current.onReorderMove?.(callbacksRef.current.projectId, event),
      onDragEnd: () => callbacksRef.current.onReorderEnd?.(),
    })
  }
  useEffect(() => () => reorderControllerRef.current?.dispose(), [])

  const handleProjectClick = (event) => {
    if (reorderControllerRef.current.consumeSuppressedClick()) {
      event.preventDefault()
      return
    }
    if (isReordering) {
      event.preventDefault()
      onCancelReorder?.()
      return
    }
    onClick()
  }

  return (
    <div className={`project-sidebar-item ${active ? 'is-active' : ''} ${isReordering ? 'is-reordering' : ''}`}>
      <button
        aria-current={active ? 'page' : undefined}
        aria-describedby={isReordering ? 'reorder-mode-help' : undefined}
        aria-label={isReordering ? `${project.name}, selected for reordering` : undefined}
        className="project-sidebar-item__main"
        data-reorder-mode={isReordering ? 'active' : undefined}
        onClick={handleProjectClick}
        onLostPointerCapture={(event) => reorderControllerRef.current.pointerCancel(event)}
        onPointerCancel={(event) => reorderControllerRef.current.pointerCancel(event)}
        onPointerDown={(event) => {
          if (!onLongPressReorder) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          reorderControllerRef.current.pointerDown(event)
        }}
        onPointerMove={(event) => reorderControllerRef.current.pointerMove(event)}
        onPointerUp={(event) => reorderControllerRef.current.pointerUp(event)}
        data-reorder-id={project.id}
        onContextMenu={(event) => event.preventDefault()}
        type="button"
      >
        <span className={`project-dot project-dot--${PROJECT_COLORS[project.color] ?? 'teal'}`} />
        <span className="sidebar-row__label">{project.name}</span>
        <span className="sidebar-row__count">{count}</span>
      </button>
      <span className="project-sidebar-item__actions">
        <button aria-label={`Edit ${project.name}`} onClick={onEdit} title={`Edit ${project.name}`} type="button">Edit</button>
        <button aria-label={`Delete ${project.name}`} onClick={onDelete} title={`Delete ${project.name}`} type="button">Delete</button>
        <button aria-label={`Move ${project.name} earlier`} disabled={!canMoveEarlier} onClick={onMoveEarlier} title="Move project earlier" type="button">
          <Icon name="chevronUp" size={14} />
        </button>
        <button aria-label={`Move ${project.name} later`} disabled={!canMoveLater} onClick={onMoveLater} title="Move project later" type="button">
          <Icon name="chevronDown" size={14} />
        </button>
      </span>
    </div>
  )
}

function TaskRow({
  canMoveEarlier,
  canMoveLater,
  isReordering,
  onCancelReorder,
  onLongPressReorder,
  onReorderMove,
  onReorderEnd,
  onMoveEarlier,
  onMoveLater,
  task,
  onToggle,
  onOpen,
}) {
  const callbacksRef = useRef({ onLongPressReorder, onReorderEnd, onReorderMove, taskId: task.id })
  callbacksRef.current = { onLongPressReorder, onReorderEnd, onReorderMove, taskId: task.id }
  const reorderControllerRef = useRef(null)
  if (!reorderControllerRef.current) {
    reorderControllerRef.current = createLongPressReorderController({
      onLongPress: () => callbacksRef.current.onLongPressReorder?.(callbacksRef.current.taskId),
      onDragMove: (event) => callbacksRef.current.onReorderMove?.(callbacksRef.current.taskId, event),
      onDragEnd: () => callbacksRef.current.onReorderEnd?.(),
    })
  }
  useEffect(() => () => reorderControllerRef.current?.dispose(), [])

  const handleTaskOpen = (event) => {
    if (reorderControllerRef.current.consumeSuppressedClick()) {
      event.preventDefault()
      return
    }
    if (isReordering) {
      event.preventDefault()
      onCancelReorder?.()
      return
    }
    onOpen(task)
  }

  return (
    <article className={`task-row ${task.completed ? 'is-completed' : ''} ${isReordering ? 'is-reordering' : ''}`}>
      <button
        aria-label={task.completed ? `Restore ${task.title}` : `Complete ${task.title}`}
        className="task-check"
        onClick={() => onToggle(task.id)}
        title={task.completed ? 'Restore task' : 'Complete task'}
        type="button"
      >
        {task.completed ? <span>✓</span> : null}
      </button>
      <button
        aria-describedby={isReordering ? 'reorder-mode-help' : undefined}
        aria-label={isReordering ? `${task.title}, selected for reordering` : undefined}
        className="task-row__body"
        data-reorder-mode={isReordering ? 'active' : undefined}
        onClick={handleTaskOpen}
        onLostPointerCapture={(event) => reorderControllerRef.current.pointerCancel(event)}
        onPointerCancel={(event) => reorderControllerRef.current.pointerCancel(event)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          reorderControllerRef.current.pointerDown(event)
        }}
        onPointerMove={(event) => reorderControllerRef.current.pointerMove(event)}
        onPointerUp={(event) => reorderControllerRef.current.pointerUp(event)}
        data-reorder-id={task.id}
        onContextMenu={(event) => event.preventDefault()}
        type="button"
      >
        <span className="task-row__title">{task.title}</span>
        <span className="task-row__meta">
          <span className="task-context">
            <span className={`project-dot project-dot--${task.projectColor ?? 'teal'}`} />
            {task.projectName}
          </span>
          <span className="task-note">{task.note}</span>
        </span>
      </button>
      <span className="task-row__details">
        <span className={`priority priority--${task.priorityTone}`}>{task.priority}</span>
        <span className={`task-due task-due--${task.dueTone}`}>
          <Icon name={task.due.includes(':') ? 'clock' : 'calendar'} size={15} />
          {task.due}
        </span>
        <button aria-label={`Move ${task.title} earlier`} className="icon-button task-order-button" disabled={!canMoveEarlier} onClick={onMoveEarlier} title="Move task earlier" type="button">
          <Icon name="chevronUp" size={15} />
        </button>
        <button aria-label={`Move ${task.title} later`} className="icon-button task-order-button" disabled={!canMoveLater} onClick={onMoveLater} title="Move task later" type="button">
          <Icon name="chevronDown" size={15} />
        </button>
        <button aria-label={`More actions for ${task.title}`} className="icon-button task-more" title="More actions" type="button">
          <Icon name="more" size={16} />
        </button>
      </span>
    </article>
  )
}

function SectionHeading({
  section,
  count,
  variant = 'list',
  collapsed = false,
  canMoveEarlier = false,
  canMoveLater = false,
  isReordering = false,
  onToggle,
  onLongPressReorder,
  onReorderMove,
  onReorderEnd,
  onMoveEarlier,
  onMoveLater,
}) {
  const callbacksRef = useRef({ onLongPressReorder, onReorderEnd, onReorderMove, sectionId: section.id })
  callbacksRef.current = { onLongPressReorder, onReorderEnd, onReorderMove, sectionId: section.id }
  const reorderControllerRef = useRef(null)

  if (!reorderControllerRef.current) {
    reorderControllerRef.current = createLongPressReorderController({
      onLongPress: () => callbacksRef.current.onLongPressReorder?.(callbacksRef.current.sectionId),
      onDragMove: (event) => callbacksRef.current.onReorderMove?.(callbacksRef.current.sectionId, event),
      onDragEnd: () => callbacksRef.current.onReorderEnd?.(),
    })
  }

  useEffect(() => () => reorderControllerRef.current?.dispose(), [])

  const handlePointerDown = (event) => {
    if (!onLongPressReorder || event.target.closest('button')) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    reorderControllerRef.current.pointerDown(event)
  }

  const className = variant === 'board' ? 'board-column__heading' : 'task-section__heading'

  return (
    <div
      aria-describedby={isReordering ? 'reorder-mode-help' : undefined}
      className={`${className} ${isReordering ? 'is-reordering' : ''}`}
      data-reorder-mode={isReordering ? 'active' : undefined}
      data-section-reorder-id={section.id ?? undefined}
      onContextMenu={(event) => event.preventDefault()}
      onLostPointerCapture={(event) => reorderControllerRef.current.pointerCancel(event)}
      onPointerCancel={(event) => reorderControllerRef.current.pointerCancel(event)}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => reorderControllerRef.current.pointerMove(event)}
      onPointerUp={(event) => reorderControllerRef.current.pointerUp(event)}
      role={onLongPressReorder ? 'button' : undefined}
      tabIndex={onLongPressReorder ? 0 : undefined}
    >
      <span className="section-heading__name">{section.name}</span>
      <span className="section-heading__count">{count}</span>
      <span className="section-heading__actions">
        {variant === 'list' && onToggle ? (
          <button
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${section.name}`}
            className="icon-button"
            onClick={() => onToggle(section.id, !collapsed)}
            title={collapsed ? 'Expand section' : 'Collapse section'}
            type="button"
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={16} />
          </button>
        ) : null}
        {onLongPressReorder ? (
          <>
            <button
              aria-label={`Move ${section.name} earlier`}
              className="icon-button section-order-button"
              disabled={!canMoveEarlier}
              onClick={onMoveEarlier}
              title="Move section earlier"
              type="button"
            >
              <Icon name="chevronUp" size={14} />
            </button>
            <button
              aria-label={`Move ${section.name} later`}
              className="icon-button section-order-button"
              disabled={!canMoveLater}
              onClick={onMoveLater}
              title="Move section later"
              type="button"
            >
              <Icon name="chevronDown" size={14} />
            </button>
          </>
        ) : null}
      </span>
    </div>
  )
}

function TaskComposer({ inputRef, value, onChange, onSubmit, onCancel }) {
  return (
    <form className="task-composer" onSubmit={onSubmit}>
      <button aria-label="Add task" className="composer-plus" title="Add task" type="submit">
        <Icon name="plus" size={19} />
      </button>
      <input
        aria-label="Task name"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        placeholder="What needs your attention?"
        ref={inputRef}
        type="text"
        value={value}
      />
      <span className="composer-hint">Enter to add</span>
      <button aria-label="Cancel task creation" className="icon-button composer-close" onClick={onCancel} title="Cancel" type="button">
        <Icon name="close" size={16} />
      </button>
    </form>
  )
}

function UtilityPanel({ onAction }) {
  const upcoming = [
    ['Team sync', 'Tomorrow, 9:00 AM'],
    ['Design review', 'Tomorrow, 2:00 PM'],
    ['Dentist appointment', 'Friday, 11:00 AM'],
    ['Monthly budget', 'Sunday'],
  ]

  return (
    <aside className="utility-panel" aria-label="Utility panel">
      <div className="utility-panel__heading">
        <div>
          <span className="section-kicker">LOOKING AHEAD</span>
          <h2>Upcoming</h2>
        </div>
        <button className="text-button" onClick={() => onAction('upcoming')} type="button">
          View all
        </button>
      </div>

      <div className="upcoming-list">
        {upcoming.map(([label, date]) => (
          <button className="upcoming-row" key={label} onClick={() => onAction('upcoming')} type="button">
            <span className="upcoming-row__icon">
              <Icon name="calendar" size={16} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{date}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="utility-divider" />

      <div className="utility-panel__heading">
        <div>
          <span className="section-kicker">TAGS</span>
          <h2>Tags</h2>
        </div>
        <button className="text-button" onClick={() => onAction('label:label-focus')} type="button">
          Browse
        </button>
      </div>

      <div className="tag-cloud">
        {TAGS.map((tag) => (
          <button className="tag-chip" key={tag.id} onClick={() => onAction(tag.id)} type="button">
            <Icon name="tag" size={14} />
            <span>{tag.label}</span>
            <b>{tag.count}</b>
          </button>
        ))}
      </div>

      <div className="utility-divider" />

      <div className="utility-panel__heading">
        <div>
          <span className="section-kicker">QUICK ACTIONS</span>
          <h2>Make room</h2>
        </div>
      </div>
      <div className="quick-actions">
        <button onClick={() => onAction('compose')} type="button">
          <Icon name="plus" size={17} />
          Add task
          <kbd>Ctrl N</kbd>
        </button>
        <button onClick={() => onAction('capture')} type="button">
          <Icon name="note" size={17} />
          Capture a thought
        </button>
        <button onClick={() => onAction('today')} type="button">
          <Icon name="focus" size={17} />
          Return to focus
        </button>
      </div>
    </aside>
  )
}

function CommandPalette({ query, onQueryChange, onClose, onNavigate, onCompose, onCapture }) {
  const commands = [
    { id: 'today', label: 'Open Today', detail: 'See your current focus lane', shortcut: 'Ctrl 2' },
    { id: 'inbox', label: 'Open Inbox', detail: 'Review uncategorized tasks', shortcut: 'Ctrl 1' },
    { id: 'upcoming', label: 'Open Upcoming', detail: 'Plan the next few days', shortcut: 'Ctrl 3' },
    { id: 'notes', label: 'Open Notes', detail: 'Keep durable references and ideas', shortcut: '' },
    { id: 'diary', label: 'Open Diary', detail: 'Write a private daily entry', shortcut: '' },
    { id: 'compose', label: 'Add a task', detail: 'Capture something new', shortcut: 'Ctrl N' },
    { id: 'capture', label: 'Capture a thought', detail: 'Save a local thought without leaving your flow', shortcut: 'Ctrl Shift Space' },
  ]
  const filtered = commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="command-overlay" onMouseDown={onClose}>
      <section aria-labelledby="command-title" aria-modal="true" className="command-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="command-dialog__header">
          <div className="command-dialog__title">
            <Icon name="command" size={18} />
            <span id="command-title">Jump to</span>
          </div>
          <button aria-label="Close command palette" className="icon-button" onClick={onClose} title="Close" type="button">
            <Icon name="close" size={17} />
          </button>
        </div>
        <input
          aria-label="Search commands"
          autoFocus
          className="command-dialog__input"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search views and actions"
          type="search"
          value={query}
        />
        <div className="command-list" role="listbox">
          {filtered.length ? (
            filtered.map((command) => (
              <button
                className="command-row"
                key={command.id}
                onClick={() => {
                  if (command.id === 'compose') onCompose()
                  else if (command.id === 'capture') onCapture()
                  else onNavigate(command.id)
                  onClose()
                }}
                role="option"
                type="button"
              >
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.detail}</small>
                </span>
                <kbd>{command.shortcut}</kbd>
              </button>
            ))
          ) : (
            <p className="command-empty">No matching actions</p>
          )}
        </div>
      </section>
    </div>
  )
}

function ThoughtCaptureTray({ session, onChange, onSave, onDismiss, onDiscard }) {
  const inputRef = useRef(null)
  const draftText = session?.draft?.text ?? ''

  useEffect(() => {
    if (!session?.isOpen) return
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(draftText.length, draftText.length)
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [draftText.length, session?.isOpen])

  if (!session?.isOpen) return null

  return (
    <aside
      aria-describedby="thought-capture-status"
      aria-labelledby="thought-capture-title"
      aria-modal="false"
      className="thought-capture"
      role="dialog"
    >
      <div className="thought-capture__header">
        <div className="thought-capture__identity">
          <span aria-hidden="true" className="thought-capture__mark">
            <Icon name="note" size={16} />
          </span>
          <div>
            <strong id="thought-capture-title">Capture a thought</strong>
            <span>Saved locally</span>
          </div>
        </div>
        <button
          aria-label="Close thought capture"
          className="icon-button"
          onClick={onDismiss}
          title="Close and keep draft"
          type="button"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <textarea
        aria-label="Thought"
        autoComplete="off"
        className="thought-capture__input"
        onChange={(event) => onChange(event.target.value)}
        placeholder="What do you want to remember?"
        ref={inputRef}
        rows={4}
        value={draftText}
      />

      <div className="thought-capture__footer">
        <p id="thought-capture-status" role="status">
          {session.status === 'empty' ? 'Write something before saving.' : ''}
        </p>
        <div className="thought-capture__actions">
          <button className="text-button thought-capture__discard" onClick={onDiscard} type="button">
            Discard
          </button>
          <button className="primary-button" disabled={!draftText.trim()} onClick={onSave} type="button">
            <Icon name="plus" size={15} />
            Save thought
          </button>
        </div>
      </div>
    </aside>
  )
}

function getRouteInfo(route, state) {
  if (route === 'settings') {
    return { title: 'Settings', kicker: 'WORKSPACE PREFERENCES', subtitle: 'Tune Daymark to your own working rhythm.' }
  }
  if (route === 'inbox') {
    return { title: 'Inbox', kicker: 'CAPTURED WORK', subtitle: 'A quiet place to sort what just arrived.' }
  }
  if (route === 'upcoming') {
    return { title: 'Upcoming', kicker: 'NEXT HORIZON', subtitle: 'A clear runway for the days ahead.' }
  }
  if (route === 'completed') {
    return { title: 'Completed', kicker: 'WORKSPACE HISTORY', subtitle: 'Completed work stays here until you restore it.' }
  }
  if (route === 'order') {
    return { title: 'Order', kicker: 'WORKSPACE ORDER', subtitle: 'Decide what comes next, and what follows it.' }
  }
  if (route === 'notes') {
    return { title: 'Notes', kicker: 'PERSONAL REFERENCE', subtitle: 'Keep durable ideas close to the work they support.' }
  }
  if (route === 'diary') {
    return { title: 'Diary', kicker: 'DAILY REFLECTION', subtitle: 'Write a private, durable record of the day.' }
  }
  if (route.startsWith('project:')) {
    const project = state.projects[route.slice('project:'.length)]
    return { title: project?.name ?? 'Project', kicker: 'PROJECT VIEW', subtitle: 'Keep the next useful step visible.' }
  }
  if (route.startsWith('label:')) {
    const tag = state.labels[route.slice('label:'.length)]
    return { title: tag?.name ?? 'Tag', kicker: 'SAVED VIEW', subtitle: 'A focused lens across your work.' }
  }
  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()
  return { title: 'Today', kicker: today, subtitle: 'A clear view of what matters now.' }
}

const CALENDAR_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function calendarDates(cursor, mode) {
  if (mode === 'week') {
    const start = startOfWeek(cursor, 1)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }
  const start = startOfWeek(startOfMonth(cursor), 1)
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

function calendarRangeLabel(cursor, mode) {
  const date = fromLocalDate(cursor)
  if (mode === 'year') return String(date.getFullYear())
  if (mode === 'week') {
    const end = fromLocalDate(addDays(startOfWeek(cursor, 1), 6))
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
    return `${formatter.format(fromLocalDate(startOfWeek(cursor, 1)))} - ${formatter.format(end)}`
  }
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date)
}

function monthLabel(date) {
  return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(fromLocalDate(date))
}

function UpcomingCalendar({
  cursor,
  mode,
  onCursorChange,
  onModeChange,
  onCreate,
  onEdit,
  onMove,
  onSelectedDateChange,
  selectedDate,
  tasks,
}) {
  const taskBuckets = useMemo(() => {
    return tasks.reduce((buckets, task) => {
      if (!task.due?.date) return buckets
      if (!buckets[task.due.date]) buckets[task.due.date] = []
      buckets[task.due.date].push(task)
      return buckets
    }, {})
  }, [tasks])

  const moveCursor = (amount) => {
    onCursorChange((current) => {
      if (mode === 'year') return addYears(current, amount)
      if (mode === 'month') return addMonths(current, amount)
      return addDays(current, amount * 7)
    })
  }

  const renderDay = (date, compact = false) => {
    const dayTasks = taskBuckets[date] ?? []
    const dateObject = fromLocalDate(date)
    const isToday = date === toLocalDate(new Date())
    const isSelected = date === selectedDate
    const isCurrentMonth = date.slice(0, 7) === cursor.slice(0, 7)

    return (
      <section
        className={[
          'upcoming-day',
          compact && 'upcoming-day--week',
          !compact && !isCurrentMonth && 'upcoming-day--outside',
          isToday && 'upcoming-day--today',
          isSelected && 'upcoming-day--selected',
          dayTasks.length && 'upcoming-day--scheduled',
        ].filter(Boolean).join(' ')}
        key={date}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const taskId = event.dataTransfer.getData('text/daymark-task')
          if (taskId) onMove(taskId, date)
        }}
      >
        <button
          aria-label={`Open ${new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(dateObject)}${dayTasks.length ? `, ${dayTasks.length} tasks` : ''}`}
          className="upcoming-day__date"
          onClick={() => onSelectedDateChange(date)}
          type="button"
        >
          <span>{dateObject.getDate()}</span>
          {dayTasks.length ? <i aria-hidden="true" /> : null}
        </button>
        <div className="upcoming-day__tasks">
          {dayTasks.slice(0, compact ? 6 : 3).map((task) => (
            <button
              className={`upcoming-task-chip ${task.completedAt ? 'is-completed' : ''}`}
              draggable
              key={task.id}
              onClick={() => onEdit(task)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/daymark-task', task.id)
              }}
              type="button"
            >
              <span className={`project-dot project-dot--${PROJECT_COLORS[task.projectId] ?? 'teal'}`} />
              <b>{task.content}</b>
              {task.due?.time ? <small>{formatTime(task.due.time)}</small> : null}
            </button>
          ))}
          {dayTasks.length > (compact ? 6 : 3) ? <span className="upcoming-day__more">+{dayTasks.length - (compact ? 6 : 3)} more</span> : null}
        </div>
        <button
          aria-label={`Add task on ${date}`}
          className="upcoming-day__add"
          onClick={() => onCreate(date)}
          title="Add task on this day"
          type="button"
        >
          <Icon name="plus" size={14} />
        </button>
      </section>
    )
  }

  const renderMiniMonth = (monthOffset) => {
    const month = addMonths(startOfMonth(cursor), monthOffset)
    const monthDates = calendarDates(month, 'month').filter((date) => date.slice(0, 7) === month.slice(0, 7))
    return (
      <button
        className={`year-month ${month.slice(0, 4) === selectedDate.slice(0, 4) && month.slice(5, 7) === selectedDate.slice(5, 7) ? 'is-selected' : ''}`}
        key={month}
        onClick={() => {
          onCursorChange(month)
          onSelectedDateChange(month)
        }}
        type="button"
      >
        <strong>{monthLabel(month)}</strong>
        <span className="year-month__dots" aria-label={`${taskBuckets[month] ? taskBuckets[month].length : 0} tasks`}>
          {monthDates.map((date) => <i className={(taskBuckets[date]?.length ?? 0) > 0 ? 'is-scheduled' : ''} key={date} />)}
        </span>
      </button>
    )
  }

  return (
    <section aria-label="Upcoming calendar" className="upcoming-calendar">
      <div className="upcoming-calendar__toolbar">
        <div className="calendar-mode-control" role="group" aria-label="Calendar mode">
          {['week', 'month', 'year'].map((candidate) => (
            <button
              aria-pressed={mode === candidate}
              className={mode === candidate ? 'is-selected' : ''}
              key={candidate}
              onClick={() => onModeChange(candidate)}
              type="button"
            >
              {candidate[0].toUpperCase() + candidate.slice(1)}
            </button>
          ))}
        </div>
        <div className="calendar-nav">
          <button aria-label="Previous calendar range" className="icon-button" onClick={() => moveCursor(-1)} title="Previous" type="button"><Icon name="arrowUp" size={16} /></button>
          <button className="calendar-today-button" onClick={() => { const today = toLocalDate(new Date()); onCursorChange(today); onSelectedDateChange(today) }} type="button">Today</button>
          <button aria-label="Next calendar range" className="icon-button calendar-nav__next" onClick={() => moveCursor(1)} title="Next" type="button"><Icon name="arrowUp" size={16} /></button>
        </div>
        <strong className="calendar-range-label" aria-live="polite">{calendarRangeLabel(cursor, mode)}</strong>
      </div>

      {mode === 'year' ? (
        <div className="year-grid">{Array.from({ length: 12 }, (_, index) => renderMiniMonth(index))}</div>
      ) : (
        <div className={`upcoming-grid upcoming-grid--${mode}`}>
          {mode === 'month' ? CALENDAR_WEEKDAYS.map((day) => <span className="upcoming-grid__weekday" key={day}>{day}</span>) : null}
          {calendarDates(cursor, mode).map((date) => renderDay(date, mode === 'week'))}
        </div>
      )}

      <footer className="upcoming-calendar__footer">
        <span><i className="calendar-legend-dot" /> Days with tasks are marked in green</span>
        <button className="text-button" onClick={() => onCreate(selectedDate)} type="button"><Icon name="plus" size={14} /> Add task on {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(fromLocalDate(selectedDate))}</button>
      </footer>
    </section>
  )
}

function ProjectDialog({ draft, error, onChange, onClose, onSubmit }) {
  return (
    <div className="integration-modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form aria-labelledby="project-dialog-title" className="project-dialog" onSubmit={onSubmit}>
        <div className="project-dialog__header">
          <div>
            <span className="section-kicker">NEW PROJECT</span>
            <h2 id="project-dialog-title">Make a place for this work</h2>
          </div>
          <button aria-label="Close project creation" className="icon-button" onClick={onClose} type="button"><Icon name="close" size={17} /></button>
        </div>
        <label>Project name<input autoFocus onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="e.g. Client launch" value={draft.name} /></label>
        <label>Description<textarea onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="What is this project for?" rows="3" value={draft.description} /></label>
        <fieldset>
          <legend>Color</legend>
          <div className="project-color-options">
            {['teal', 'amber', 'indigo'].map((color) => <button aria-label={`${color} project color`} aria-pressed={draft.color === color} className={`project-color project-color--${color}`} key={color} onClick={() => onChange({ ...draft, color })} type="button" />)}
          </div>
        </fieldset>
        <label className="project-dialog__checkbox"><input checked={draft.addSection} onChange={(event) => onChange({ ...draft, addSection: event.target.checked })} type="checkbox" /> Add a "Next" section</label>
        {error ? <p className="project-dialog__error" role="alert">{error}</p> : null}
        <footer><button className="secondary-button" onClick={onClose} type="button">Cancel</button><button className="primary-button" type="submit">Create project</button></footer>
      </form>
    </div>
  )
}

function IntegrationStyles() {
  return (
    <style>{`
      .upcoming-calendar{border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:var(--shadow);overflow:hidden}
      .upcoming-calendar__toolbar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;min-height:68px;padding:0 16px;border-bottom:1px solid var(--line)}
      .calendar-mode-control{display:inline-flex;justify-self:start;padding:3px;border:1px solid var(--line);border-radius:7px;background:var(--surface-soft)}
      .calendar-mode-control button{min-height:29px;padding:0 9px;border-radius:5px;background:transparent;color:var(--ink-soft);cursor:pointer;font-size:11px;font-weight:700}.calendar-mode-control button.is-selected{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
      .calendar-nav{display:inline-flex;align-items:center;gap:2px}.calendar-nav .icon-button{transform:rotate(-90deg)}.calendar-nav__next{transform:rotate(90deg)!important}.calendar-today-button{min-height:30px;padding:0 9px;background:transparent;color:var(--ink-soft);cursor:pointer;font-size:11px;font-weight:700}.calendar-today-button:hover{color:var(--teal)}
      .calendar-range-label{justify-self:end;color:var(--ink);font-size:13px}.upcoming-grid{display:grid}.upcoming-grid--month{grid-template-columns:repeat(7,minmax(0,1fr))}.upcoming-grid--week{grid-template-columns:repeat(7,minmax(140px,1fr));overflow:auto}
      .upcoming-grid__weekday{padding:10px 12px;color:var(--ink-muted);border-bottom:1px solid var(--line);font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
      .upcoming-day{position:relative;min-height:128px;padding:8px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface)}.upcoming-day:nth-child(7n){border-right:0}.upcoming-day--outside{background:var(--surface-soft);opacity:.72}.upcoming-day--week{min-height:420px}.upcoming-day--selected{box-shadow:inset 0 0 0 2px var(--focus)}.upcoming-day--today .upcoming-day__date>span{background:var(--accent);color:white}.upcoming-day--scheduled{background:linear-gradient(180deg,rgba(38,117,83,.055),transparent 42%)}
      .upcoming-day__date{display:inline-flex;align-items:center;gap:5px;width:30px;height:30px;padding:0;background:transparent;color:var(--ink);cursor:pointer;font-size:11px;font-weight:700}.upcoming-day__date span{display:grid;width:24px;height:24px;place-items:center;border-radius:50%}.upcoming-day__date i{width:5px;height:5px;border-radius:50%;background:var(--teal)}.upcoming-day__date:hover span{background:var(--surface-tint)}
      .upcoming-day__tasks{display:grid;gap:4px;margin-top:4px}.upcoming-task-chip{display:grid;grid-template-columns:7px minmax(0,1fr);align-items:center;gap:5px;min-width:0;min-height:25px;padding:4px 5px;border:1px solid transparent;border-radius:4px;background:var(--surface-soft);color:var(--ink);cursor:grab;text-align:left}.upcoming-task-chip:hover{border-color:#a9c8bc;background:#eef7f2}.upcoming-task-chip.is-completed{opacity:.52;text-decoration:line-through}.upcoming-task-chip .project-dot{width:5px;height:5px}.upcoming-task-chip b{overflow:hidden;font-size:10px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.upcoming-task-chip small{grid-column:2;color:var(--ink-muted);font-size:9px}
      .upcoming-day__more{padding:2px 5px;color:var(--teal);font-size:10px;font-weight:700}.upcoming-day__add{position:absolute;right:6px;bottom:5px;display:grid;width:24px;height:24px;place-items:center;border-radius:5px;background:transparent;color:var(--ink-muted);cursor:pointer;opacity:0}.upcoming-day:hover .upcoming-day__add,.upcoming-day:focus-within .upcoming-day__add{opacity:1}.upcoming-day__add:hover{color:var(--teal);background:var(--teal-soft)}
      .year-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:18px}.year-month{display:grid;gap:9px;padding:12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);cursor:pointer;text-align:left}.year-month:hover,.year-month.is-selected{border-color:var(--teal);background:var(--teal-soft)}.year-month strong{font-size:11px}.year-month__dots{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.year-month__dots i{width:100%;aspect-ratio:1;border-radius:2px;background:var(--surface-tint)}.year-month__dots i.is-scheduled{background:var(--teal)}
      .upcoming-calendar__footer{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:0 15px;background:var(--surface-soft);color:var(--ink-muted);font-size:11px}.upcoming-calendar__footer span{display:inline-flex;align-items:center;gap:6px}.upcoming-calendar__footer .text-button{display:inline-flex;align-items:center;gap:5px}.calendar-legend-dot{width:7px;height:7px;border-radius:50%;background:var(--teal)}
      .integration-modal{position:fixed;z-index:30;inset:0;display:grid;place-items:center;padding:20px;background:rgba(24,32,31,.35);backdrop-filter:blur(3px)}.project-dialog{display:grid;gap:17px;width:min(440px,100%);padding:24px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);box-shadow:var(--shadow)}.project-dialog__header{display:flex;align-items:flex-start;justify-content:space-between}.project-dialog h2{margin:0;color:var(--ink);font-size:20px}.project-dialog label,.project-dialog fieldset{display:grid;gap:7px;padding:0;color:var(--ink-soft);border:0;font-size:12px;font-weight:700}.project-dialog input[type="text"],.project-dialog input:not([type]),.project-dialog textarea{width:100%;padding:10px;border:1px solid var(--line-strong);border-radius:6px;background:var(--surface);color:var(--ink);font:inherit}.project-dialog textarea{resize:vertical}.project-color-options{display:flex;gap:8px}.project-color{width:27px;height:27px;border:3px solid var(--surface);border-radius:50%;cursor:pointer}.project-color[aria-pressed="true"]{outline:2px solid var(--focus)}.project-color--teal{background:var(--teal)}.project-color--amber{background:#d99a20}.project-color--indigo{background:var(--indigo)}.project-dialog__checkbox{display:flex!important;align-items:center;gap:8px}.project-dialog__error{margin:0;color:var(--color-danger);font-size:12px}.project-dialog footer{display:flex;justify-content:flex-end;gap:9px;padding-top:3px}
      @media(max-width:900px){.upcoming-calendar__toolbar{grid-template-columns:1fr auto}.calendar-range-label{grid-column:1/-1;justify-self:start;margin-top:-8px;padding-bottom:12px}.year-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.upcoming-day{min-height:112px}}@media(max-width:620px){.upcoming-calendar__toolbar{gap:8px;padding:10px}.calendar-mode-control button{padding:0 7px}.upcoming-grid--month{overflow:auto;grid-template-columns:repeat(7,minmax(112px,1fr))}.upcoming-day{min-height:118px}.year-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:12px}.upcoming-calendar__footer{align-items:flex-start;flex-direction:column;padding:10px 14px}.upcoming-task-chip b{font-size:9px}}
    `}</style>
  )
}

function CalendarIntegrationStyle() {
  return (
    <style>{`
      .upcoming-calendar__day:has(.upcoming-calendar__task)::before{background:var(--teal,var(--color-success));border-radius:999px;content:"";height:6px;position:absolute;right:var(--space-2,8px);top:var(--space-2,8px);width:6px}
      .upcoming-plan-tray{margin-top:14px;border:1px solid var(--line);border-radius:7px;background:var(--surface)}.upcoming-plan-tray summary{display:flex;align-items:center;justify-content:space-between;min-height:42px;padding:0 13px;color:var(--ink);cursor:pointer;font-size:12px;font-weight:750}.upcoming-plan-tray summary span{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:10px;background:var(--surface-tint);color:var(--ink-muted);font-size:10px}.upcoming-plan-tray>div{display:grid;gap:2px;padding:0 7px 8px}.upcoming-plan-tray button{display:grid;grid-template-columns:12px minmax(0,1fr) auto;align-items:center;gap:7px;min-height:33px;padding:0 7px;border-radius:5px;background:transparent;color:var(--ink);cursor:pointer;text-align:left}.upcoming-plan-tray button:hover{background:var(--surface-soft)}.upcoming-plan-tray button span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.upcoming-plan-tray button small{color:var(--ink-muted);font-size:10px}.upcoming-plan-tray p{margin:0;padding:8px;color:var(--ink-muted);font-size:12px}
      @media (max-width:900px){.app-shell.sidebar-is-collapsed .shell-grid{grid-template-columns:0 minmax(0,1fr)}}
    `}</style>
  )
}

function SettingsPanel({
  onExport,
  onImport,
  onReset,
  onCopySyncLink,
  onThemeChange,
  onUiSettingsChange,
  settings,
  state,
  syncAndroidLink,
  syncKey,
  syncLink,
  syncStatus,
}) {
  const fileInputRef = useRef(null)
  const storageAvailable = canUseBrowserStorage()
  const stateSize = (() => {
    try {
      return new Blob([JSON.stringify(state)]).size
    } catch {
      return 0
    }
  })()

  return (
    <section aria-labelledby="settings-title" className="settings-page">
      <div className="settings-page__intro">
        <div>
          <span className="section-kicker">WORKSPACE PREFERENCES</span>
          <h2 id="settings-title">Settings</h2>
          <p>Keep Daymark comfortable for the way you plan, capture, and review work.</p>
        </div>
        <span className={`storage-badge ${storageAvailable ? 'is-ready' : 'is-warning'}`} role="status">
          <span className="storage-badge__dot" />
          {storageAvailable ? 'Saved locally' : 'Storage unavailable'}
        </span>
      </div>

      <div className="settings-grid">
        <section className="settings-section">
          <div className="settings-section__heading">
            <div>
              <h3>Appearance</h3>
              <p>Choose a calm visual mode for long planning sessions.</p>
            </div>
          </div>
          <label className="settings-field">
            <span>
              <strong>Theme</strong>
              <small>Light, dark, or match your device.</small>
            </span>
            <select aria-label="Theme preference" onChange={(event) => onThemeChange(event.target.value)} value={state.preferences.theme}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="settings-field">
            <span>
              <strong>Text size</strong>
              <small>Increase labels and task copy without changing layout.</small>
            </span>
            <select aria-label="Text size" onChange={(event) => onUiSettingsChange({ textScale: event.target.value })} value={settings.textScale}>
              <option value="default">Default</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label className="settings-field">
            <span>
              <strong>Interface density</strong>
              <small>Use more breathing room or fit more tasks on screen.</small>
            </span>
            <select aria-label="Interface density" onChange={(event) => onUiSettingsChange({ density: event.target.value })} value={settings.density}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <div>
              <h3>Planning defaults</h3>
              <p>Make the calendar and task list reflect your working rhythm.</p>
            </div>
          </div>
          <label className="settings-field">
            <span>
              <strong>Week starts on</strong>
              <small>Used by Upcoming calendar navigation and grouping.</small>
            </span>
            <select aria-label="Week starts on" onChange={(event) => onUiSettingsChange({ weekStartsOn: event.target.value })} value={settings.weekStartsOn}>
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </select>
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Show completed tasks</strong>
              <small>Keep finished work visible in task lists and search results.</small>
            </span>
            <input checked={state.preferences.showCompleted} onChange={(event) => onUiSettingsChange({ showCompleted: event.target.checked })} type="checkbox" />
          </label>
        </section>

        <section className="settings-section settings-section--wide">
          <div className="settings-section__heading">
            <div>
              <h3>Data and recovery</h3>
              <p>Export a portable copy before moving devices or making a large change.</p>
            </div>
            <span className="settings-metric">{Math.max(1, Math.round(stateSize / 1024))} KB</span>
          </div>
          <div className="settings-actions">
            <button className="secondary-button" onClick={onExport} type="button">
              <Icon name="arrowUp" size={16} />
              Export backup
            </button>
            <button className="secondary-button" onClick={() => fileInputRef.current?.click()} type="button">
              <Icon name="inbox" size={16} />
              Import backup
            </button>
            <input
              accept="application/json,.json"
              aria-label="Import Daymark backup"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onImport(file)
                event.target.value = ''
              }}
              ref={fileInputRef}
              type="file"
            />
          </div>
          <div className="settings-recovery">
            <span className="settings-recovery__icon"><Icon name="focus" size={16} /></span>
            <span>
              <strong>Local-first storage</strong>
              <small>Daymark keeps your workspace in this browser. Backups are plain JSON and never uploaded.</small>
            </span>
          </div>
        </section>

        <section className="settings-section settings-section--wide">
          <div className="settings-section__heading">
            <div>
              <h3>Sync across devices</h3>
              <p>Open the pairing link on Android or another browser to share this workspace immediately.</p>
            </div>
            <span className={`storage-badge ${syncStatus === 'synced' ? 'is-ready' : 'is-warning'}`} role="status">
              <span className="storage-badge__dot" />
              {syncStatus === 'starting' ? 'Connecting' : syncStatus === 'syncing' ? 'Syncing' : syncStatus === 'synced' ? 'Synced' : syncStatus === 'conflict' ? 'Conflict' : 'Offline'}
            </span>
          </div>
          <div className="settings-recovery">
            <span className="settings-recovery__icon"><Icon name="command" size={16} /></span>
            <span>
              <strong>Pairing code</strong>
              <small className="sync-code">{syncKey}</small>
            </span>
          </div>
          <div className="settings-actions">
            <button className="secondary-button" onClick={onCopySyncLink} type="button">
              <Icon name="github" size={16} />
              Copy sync link
            </button>
            <a className="secondary-button" href={syncAndroidLink} rel="noreferrer">
              <Icon name="command" size={16} />
              Open in Android
            </a>
          </div>
          <p className="settings-help">The link contains a private, randomly generated workspace code. Keep it private.</p>
        </section>

        <section className="settings-section settings-section--wide settings-section--danger">
          <div className="settings-section__heading">
            <div>
              <h3>Reset and help</h3>
              <p>Reset only after exporting a backup. This removes the current local workspace from this browser.</p>
            </div>
          </div>
          <div className="settings-danger-row">
            <button className="danger-button" onClick={onReset} type="button">Reset local workspace</button>
            <a className="help-link" href={`${GITHUB_URL}#readme`} rel="noreferrer" target="_blank">Read project help <span aria-hidden="true">↗</span></a>
          </div>
        </section>
      </div>
    </section>
  )
}

function readablePreview(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || 'No body yet'
}

function NoteListItem({ note, selected, onComplete, onMove, onSelect }) {
  const [isDragging, setIsDragging] = useState(false)
  const lastTargetRef = useRef(null)
  const callbacksRef = useRef({ noteId: note.id, onMove })
  callbacksRef.current = { noteId: note.id, onMove }
  const controllerRef = useRef(null)

  if (!controllerRef.current) {
    controllerRef.current = createLongPressReorderController({
      onLongPress: () => {
        lastTargetRef.current = null
        setIsDragging(true)
      },
      onDragMove: (event) => {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-note-reorder-id]')
        const targetId = target?.getAttribute('data-note-reorder-id')
        if (!targetId || targetId === callbacksRef.current.noteId || targetId === lastTargetRef.current) return
        lastTargetRef.current = targetId
        callbacksRef.current.onMove?.(callbacksRef.current.noteId, targetId)
      },
      onDragEnd: () => {
        lastTargetRef.current = null
        setIsDragging(false)
      },
    })
  }

  useEffect(() => () => controllerRef.current?.dispose(), [])

  return (
    <article className={`note-list-item-shell ${selected ? 'is-selected' : ''} ${note.completedAt ? 'is-completed' : ''} ${isDragging ? 'is-dragging' : ''}`}>
      <button
        aria-label={note.completedAt ? `Restore ${note.title}` : `Complete ${note.title}`}
        className="note-complete-button"
        onClick={() => onComplete(note.id)}
        title={note.completedAt ? 'Restore note' : 'Complete note'}
        type="button"
      >
        {note.completedAt ? '✓' : ''}
      </button>
      <button
        aria-pressed={selected}
        className="note-list-item"
        data-note-reorder-id={note.id}
        onClick={(event) => {
          if (controllerRef.current.consumeSuppressedClick()) {
            event.preventDefault()
            return
          }
          onSelect(note.id)
        }}
        onContextMenu={(event) => event.preventDefault()}
        onLostPointerCapture={(event) => controllerRef.current.pointerCancel(event)}
        onPointerCancel={(event) => controllerRef.current.pointerCancel(event)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          controllerRef.current.pointerDown(event)
        }}
        onPointerMove={(event) => controllerRef.current.pointerMove(event)}
        onPointerUp={(event) => controllerRef.current.pointerUp(event)}
        type="button"
      >
        <strong>{note.title || 'Untitled note'}</strong>
        <span>{readablePreview(note.body)}</span>
      </button>
    </article>
  )
}

function DiaryField({ label, value, placeholder, onChange, rows = 5 }) {
  return (
    <label className="diary-field">
      <span>{label}</span>
      <textarea
        aria-label={label}
        className="journal-editor journal-editor--compact"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        value={value}
      />
    </label>
  )
}

function JournalView({
  journal,
  onDiaryUpdate,
  onNoteAdd,
  onNoteComplete,
  onNoteDelete,
  onNoteMove,
  onNoteUpdate,
  route,
}) {
  const today = toLocalDate(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedNoteId, setSelectedNoteId] = useState(() => journal.notes[0]?.id ?? null)
  const selectedNote = journal.notes.find((note) => note.id === selectedNoteId) ?? null
  const diaryEntry = journal.diaryEntries[selectedDate] ?? {
    body: '',
    morning: '',
    highlights: '',
    reflection: '',
    tomorrow: '',
  }

  useEffect(() => {
    if (!selectedNoteId || journal.notes.some((note) => note.id === selectedNoteId)) return
    setSelectedNoteId(journal.notes[0]?.id ?? null)
  }, [journal.notes, selectedNoteId])

  if (route === 'diary') {
    return (
      <section aria-label="Diary" className="journal-view">
        <div className="journal-toolbar">
          <div className="diary-date-controls">
            <button
              aria-label="Previous diary day"
              className="icon-button"
              onClick={() => setSelectedDate((date) => addDays(date, -1))}
              title="Previous day"
              type="button"
            >
              <Icon name="chevronUp" size={16} />
            </button>
            <label>
            <span>Date</span>
            <input aria-label="Diary date" onChange={(event) => setSelectedDate(event.target.value)} type="date" value={selectedDate} />
            </label>
            <button className="text-button" onClick={() => setSelectedDate(today)} type="button">Today</button>
            <button
              aria-label="Next diary day"
              className="icon-button"
              onClick={() => setSelectedDate((date) => addDays(date, 1))}
              title="Next day"
              type="button"
            >
              <Icon name="chevronDown" size={16} />
            </button>
          </div>
          <span className="journal-saved" role="status">
            {Object.values(diaryEntry).some((value) => typeof value === 'string' && value.trim()) ? 'Saved locally' : 'Start a new day'}
          </span>
        </div>
        <div className="diary-intro">
          <div>
            <span className="section-kicker">A DAY IN VIEW</span>
            <h2>{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(fromLocalDate(selectedDate))}</h2>
          </div>
          <p>Capture the shape of the day in small, useful pieces. Each section saves immediately and syncs with the rest of Daymark.</p>
        </div>
        <div className="diary-entry-grid">
          <DiaryField label="Start of day" placeholder="What matters as you begin?" value={diaryEntry.morning} onChange={(value) => onDiaryUpdate(selectedDate, { morning: value })} />
          <DiaryField label="Highlights" placeholder="What went well or deserves remembering?" value={diaryEntry.highlights} onChange={(value) => onDiaryUpdate(selectedDate, { highlights: value })} />
          <DiaryField label="Reflection" placeholder="What did you learn, notice, or feel?" value={diaryEntry.reflection} onChange={(value) => onDiaryUpdate(selectedDate, { reflection: value })} />
          <DiaryField label="Tomorrow" placeholder="What should your future self see first?" value={diaryEntry.tomorrow} onChange={(value) => onDiaryUpdate(selectedDate, { tomorrow: value })} />
          <label className="diary-field diary-field--wide">
            <span>Free notes</span>
            <textarea
              aria-label={`Diary entry for ${selectedDate}`}
              className="journal-editor"
              onChange={(event) => onDiaryUpdate(selectedDate, { body: event.target.value })}
              placeholder="Anything else worth carrying forward..."
              rows={10}
              value={diaryEntry.body}
            />
          </label>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Notes" className="journal-view notes-layout">
      <div className="notes-list">
        <div className="journal-toolbar">
          <strong>{journal.notes.length} note{journal.notes.length === 1 ? '' : 's'}</strong>
          <button
            aria-label="Create note"
            className="primary-button"
            onClick={() => {
              const id = createId('note')
              onNoteAdd({ id, title: 'Untitled note', body: '' })
              setSelectedNoteId(id)
            }}
            type="button"
          >
            <Icon name="plus" size={16} />
            New note
          </button>
        </div>
        {journal.notes.length ? (
            journal.notes.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              onComplete={onNoteComplete}
              onMove={onNoteMove}
              onSelect={setSelectedNoteId}
              selected={note.id === selectedNoteId}
            />
          ))
        ) : (
          <p className="journal-empty">Create a note for ideas, references, or decisions you want to keep.</p>
        )}
      </div>
      <div className="note-editor">
        {selectedNote ? (
          <>
            <div className="journal-toolbar">
              <span className="journal-saved" role="status">{selectedNote.completedAt ? 'Completed note' : 'Saved locally'}</span>
              <button className="secondary-button" onClick={() => onNoteComplete(selectedNote.id)} type="button">
                <Icon name="check" size={15} />
                {selectedNote.completedAt ? 'Restore note' : 'Complete note'}
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  if (window.confirm(`Delete "${selectedNote.title || 'Untitled note'}"?`)) {
                    onNoteDelete(selectedNote.id)
                  }
                }}
                type="button"
              >
                Delete note
              </button>
            </div>
            <input
              aria-label="Note title"
              className="note-title-input"
              onChange={(event) => onNoteUpdate(selectedNote.id, { title: event.target.value })}
              placeholder="Note title"
              type="text"
              value={selectedNote.title}
            />
            <textarea
              aria-label="Note body"
              className="journal-editor"
              onChange={(event) => onNoteUpdate(selectedNote.id, { body: event.target.value })}
              placeholder="Write the details you want to keep."
              rows={18}
              value={selectedNote.body}
            />
          </>
        ) : (
          <div className="journal-empty">
            <h2>No note selected</h2>
            <p>Create a note to keep an idea or reference available across reloads.</p>
          </div>
        )}
      </div>
    </section>
  )
}

function App() {
  const state = useAppState()
  const { setPreference } = useTheme()
  const [route, setRoute] = useState('today')
  const [viewMode, setViewMode] = useState('list')
  const [composerOpen, setComposerOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => (
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 721px)').matches
  ))
  const [selectedTask, setSelectedTask] = useState(null)
  const [notice, setNotice] = useState('')
  const [undoAvailable, setUndoAvailable] = useState(false)
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => toLocalDate(new Date()))
  const [taskEditor, setTaskEditor] = useState(null)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [projectToEdit, setProjectToEdit] = useState(null)
  const [sectionComposerOpen, setSectionComposerOpen] = useState(false)
  const [sectionDraft, setSectionDraft] = useState('')
  const [reorderMode, setReorderMode] = useState(null)
  const [captureSession, setCaptureSession] = useState(null)
  const [captureNotice, setCaptureNotice] = useState('')
  const [uiSettings, setUiSettings] = useState(() => readUiSettings())
  const [syncKey] = useState(() => getSyncKey(getBrowserStorage()))
  const [syncStatus, setSyncStatus] = useState('starting')
  const syncReadyRef = useRef(false)
  const syncRemoteRevisionRef = useRef(0)
  const syncPushTimerRef = useRef(null)
  const syncChannelRef = useRef(null)
  const syncSourceRef = useRef(null)
  const reorderPointerTargetRef = useRef(null)
  const composerRef = useRef(null)
  const captureReturnFocusRef = useRef(null)
  const agentBridgeActionsRef = useRef(null)

  useEffect(() => {
    seedDemoWorkspace()
  }, [])

  useEffect(() => {
    let cancelled = false
    const source = `${appStore.getState().clientId}:${Math.random().toString(36).slice(2)}`
    syncSourceRef.current = source
    const applyRemoteState = (remoteState) => {
      const local = appStore.getState()
      if (
        remoteState.revision > local.revision ||
        (remoteState.revision === local.revision && remoteState.updatedAt > local.updatedAt)
      ) {
        syncRemoteRevisionRef.current = Math.max(syncRemoteRevisionRef.current, remoteState.revision)
        appStore.replace(remoteState)
        setSyncStatus('synced')
      }
    }
    syncChannelRef.current = createSyncChannel(syncKey, source, applyRemoteState)
    const initializeSync = async () => {
      try {
        const remote = await pullSyncState(syncKey)
        if (cancelled) return
        const local = appStore.getState()
        if (
          remote.state &&
          (remote.revision > local.revision ||
            (remote.revision === local.revision && remote.state.updatedAt > local.updatedAt))
        ) {
          appStore.replace(remote.state)
          syncRemoteRevisionRef.current = remote.revision
        } else if (
          !remote.state ||
          local.revision > remote.revision ||
          (local.revision === remote.revision && local.updatedAt > remote.state.updatedAt)
        ) {
          const pushed = await pushSyncState(syncKey, local, remote.revision)
          if (cancelled) return
          syncRemoteRevisionRef.current = pushed.revision
        } else {
          syncRemoteRevisionRef.current = remote.revision
        }
        syncReadyRef.current = true
        setSyncStatus('synced')
      } catch {
        if (cancelled) return
        syncReadyRef.current = true
        setSyncStatus('offline')
      }
    }
    initializeSync()
    return () => {
      cancelled = true
      if (syncPushTimerRef.current) window.clearTimeout(syncPushTimerRef.current)
      syncChannelRef.current?.close()
      syncChannelRef.current = null
    }
  }, [syncKey])

  useEffect(() => {
    if (!syncReadyRef.current || state.revision === 0) return
    if (syncPushTimerRef.current) window.clearTimeout(syncPushTimerRef.current)
    syncPushTimerRef.current = window.setTimeout(async () => {
      setSyncStatus('syncing')
      try {
        const pushed = await pushSyncState(syncKey, state, syncRemoteRevisionRef.current)
        syncRemoteRevisionRef.current = pushed.revision
        syncChannelRef.current?.publish(pushed.state)
        setSyncStatus('synced')
      } catch (error) {
        if (error?.code === 'conflict' && error.state) {
          const remoteRevision = Number(error.revision ?? error.state.revision)
          const merged = mergeSyncStates(appStore.getState(), error.state)
          const rebased = {
            ...merged,
            revision: Math.max(merged.revision, remoteRevision) + 1,
            updatedAt: new Date().toISOString(),
          }
          syncRemoteRevisionRef.current = remoteRevision
          appStore.replace(rebased)
          setNotice('Daymark merged changes from another device and is syncing again.')
          setSyncStatus('syncing')
        } else {
          setSyncStatus('offline')
        }
      }
    }, 50)
    return () => {
      if (syncPushTimerRef.current) window.clearTimeout(syncPushTimerRef.current)
    }
  }, [state, state.revision, syncKey])

  useEffect(() => {
    if (!syncReadyRef.current) return undefined
    let cancelled = false
    const refreshRemote = async () => {
      try {
        const remote = await pullSyncState(syncKey)
        if (cancelled || !remote.state) return
        const local = appStore.getState()
        if (
          remote.revision > syncRemoteRevisionRef.current &&
          (remote.revision > local.revision ||
            (remote.revision === local.revision && remote.state.updatedAt >= local.updatedAt))
        ) {
          syncRemoteRevisionRef.current = remote.revision
          appStore.replace(remote.state)
          setSyncStatus('synced')
        }
      } catch {
        if (!cancelled) setSyncStatus('offline')
      }
    }
    let timer = null
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await refreshRemote()
        if (!cancelled) schedule()
      }, document.visibilityState === 'hidden' ? 2000 : 350)
    }
    const refreshImmediately = () => {
      refreshRemote()
    }
    window.addEventListener('online', refreshImmediately)
    document.addEventListener('visibilitychange', refreshImmediately)
    schedule()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      window.removeEventListener('online', refreshImmediately)
      document.removeEventListener('visibilitychange', refreshImmediately)
    }
  }, [syncKey, syncStatus])

  const copySyncLink = async () => {
    const link = getSyncLink(syncKey)
    try {
      await navigator.clipboard.writeText(link)
      setNotice('Sync link copied. Open it on Android to pair this workspace.')
    } catch {
      setNotice(link)
    }
  }

  useEffect(() => {
    const legacy = readLegacyJournal(getBrowserStorage())
    if (!legacy) return
    let migrated = true
    const current = appStore.getState()
    legacy.notes.forEach((note) => {
      if (current.notes[note.id]) return
      const result = appStore.dispatch({
        type: 'note.add',
        input: { id: note.id, title: note.title, body: note.body },
      })
      if (!result.ok) migrated = false
    })
    Object.values(legacy.diary).forEach((entry) => {
      if (appStore.getState().diaryEntries[entry.date]) return
      const result = appStore.dispatch({ type: 'diary.upsert', date: entry.date, body: entry.body })
      if (!result.ok) migrated = false
    })
    if (migrated) clearLegacyJournal(getBrowserStorage())
  }, [])

  useEffect(() => {
    if (state.preferences.theme !== document.documentElement.dataset.theme) {
      setPreference(state.preferences.theme)
    }
  }, [setPreference, state.preferences.theme])

  const tasks = useMemo(
    () => Object.values(state.tasks).map((task) => toViewTask(task, state)),
    [state],
  )
  const calendarTasks = useMemo(
    () => Object.values(state.tasks),
    [state.tasks],
  )
  const journal = useMemo(
    () => ({
      notes: Object.values(state.notes).sort((left, right) => left.order - right.order || right.updatedAt.localeCompare(left.updatedAt)),
      diaryEntries: state.diaryEntries,
    }),
    [state.diaryEntries, state.notes],
  )
  const today = toLocalDate(new Date())
  const projectItems = useMemo(
    () =>
      Object.values(state.projects)
        .filter((project) => project.id !== state.preferences.inboxProjectId && !project.isArchived)
        .sort((left, right) => left.order - right.order),
    [state],
  )
  const orderItems = useMemo(
    () => Object.values(state.orderItems ?? {}).sort((left, right) => left.order - right.order),
    [state.orderItems],
  )
  const labelItems = useMemo(
    () => Object.values(state.labels).sort((left, right) => left.order - right.order),
    [state],
  )
  const routeInfo = getRouteInfo(route, state)
  const visibleTasks = useMemo(() => {
    const availableTasks = route === 'completed' || state.preferences.showCompleted
      ? tasks
      : tasks.filter((task) => !task.completed)
    if (searchTerm.trim()) {
      const query = searchTerm.trim().toLowerCase()
      return availableTasks.filter((task) => `${task.title} ${task.note} ${task.priority} ${task.projectName} ${task.tagName}`.toLowerCase().includes(query))
    }
    let scoped = availableTasks
    if (route === 'inbox') scoped = availableTasks.filter((task) => task.project === state.preferences.inboxProjectId)
    if (route === 'upcoming') scoped = availableTasks.filter((task) => state.tasks[task.id]?.due?.date >= today)
    if (route.startsWith('project:')) scoped = availableTasks.filter((task) => task.project === route.slice('project:'.length))
    if (route.startsWith('label:')) scoped = availableTasks.filter((task) => task.tag === route.slice('label:'.length))
    if (route === 'today') scoped = availableTasks.filter((task) => state.tasks[task.id]?.due?.date === today)
    if (route === 'completed') scoped = tasks.filter((task) => task.completed)
    if (route !== 'completed' && !state.preferences.showCompleted) scoped = scoped.filter((task) => !task.completed)
    return scoped
  }, [route, searchTerm, state.preferences.inboxProjectId, state.preferences.showCompleted, state.tasks, tasks, today])

  const sections = useMemo(() => {
    const orderedTasks = [...visibleTasks].sort((left, right) => {
      const leftTask = state.tasks[left.id]
      const rightTask = state.tasks[right.id]
      return (leftTask?.order ?? 0) - (rightTask?.order ?? 0) || left.id.localeCompare(right.id)
    })
    const projectId = route.startsWith('project:') ? route.slice('project:'.length) : null

    if (projectId) {
      const projectSections = Object.values(state.sections)
        .filter((section) => section.projectId === projectId)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
        .map((section) => ({
          id: section.id,
          projectId: section.projectId,
          name: section.name,
          tasks: orderedTasks.filter((task) => task.sectionId === section.id),
        }))
      const unsectioned = orderedTasks.filter((task) => !task.sectionId)
      return unsectioned.length
        ? [...projectSections, { id: null, name: 'Unsectioned', tasks: unsectioned }]
        : projectSections
    }

    const groups = new Map()
    for (const task of orderedTasks) {
      const sectionRecord = task.sectionId ? state.sections[task.sectionId] : null
      const key = task.sectionId ?? `name:${task.section}`
      if (!groups.has(key)) {
        groups.set(key, {
          id: sectionRecord?.id ?? null,
          projectId: sectionRecord?.projectId ?? null,
          name: sectionRecord?.name ?? task.section,
          order: sectionRecord?.order ?? Number.MAX_SAFE_INTEGER,
          tasks: [],
        })
      }
      groups.get(key).tasks.push(task)
    }
    return [...groups.values()]
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
      .map(({ order, ...section }) => section)
  }, [route, state.sections, state.tasks, visibleTasks])

  useEffect(() => {
    if (composerOpen) {
      window.setTimeout(() => composerRef.current?.focus(), 0)
    }
  }, [composerOpen])

  const openThoughtCapture = () => {
    if (commandOpen || taskEditor || projectDialogOpen) return
    captureReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCaptureNotice('')
    setCaptureSession(openCapture(thoughtCaptureStore.read(), null))
  }

  const restoreCaptureFocus = () => {
    const element = captureReturnFocusRef.current
    captureReturnFocusRef.current = null
    if (!element) return
    window.requestAnimationFrame(() => {
      if (document.contains(element)) element.focus()
    })
  }

  const updateThoughtCapture = (text) => {
    if (!captureSession?.isOpen) return
    const result = updateCaptureDraft(
      thoughtCaptureStore.read(),
      captureSession,
      text,
      new Date().toISOString(),
    )
    thoughtCaptureStore.write(result.snapshot)
    setCaptureSession(result.session)
  }

  const saveThoughtCapture = () => {
    if (!captureSession?.isOpen) return
    const result = submitCapture(
      thoughtCaptureStore.read(),
      captureSession,
      createId('thought'),
      new Date().toISOString(),
    )
    if (!result.ok) {
      setCaptureSession(result.session)
      return
    }
    thoughtCaptureStore.write(result.snapshot)
    setCaptureSession(result.session)
    setCaptureNotice('Thought saved locally.')
    restoreCaptureFocus()
  }

  const dismissThoughtCapture = () => {
    if (!captureSession?.isOpen) return
    setCaptureSession(dismissCapture(captureSession))
    restoreCaptureFocus()
  }

  const discardThoughtCapture = () => {
    if (!captureSession?.isOpen) return
    const result = discardCapture(thoughtCaptureStore.read(), captureSession)
    thoughtCaptureStore.write(result.snapshot)
    setCaptureSession(result.session)
    setCaptureNotice('Draft discarded.')
    restoreCaptureFocus()
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      const isTyping = target instanceof HTMLElement && Boolean(target.closest('input, textarea, [contenteditable="true"]'))
      const modifier = event.ctrlKey || event.metaKey
      const captureAction = getCaptureInteractionAction(
        {
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          defaultPrevented: event.defaultPrevented,
          isComposing: event.isComposing,
          key: event.key,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        },
        captureSession?.isOpen ? 'open' : 'closed',
      )

      if (captureAction === 'open') {
        if (commandOpen || taskEditor || projectDialogOpen) return
        event.preventDefault()
        openThoughtCapture()
        return
      }
      if (captureAction === 'dismiss') {
        event.preventDefault()
        dismissThoughtCapture()
        return
      }
      if (captureAction === 'submit' && captureSession?.isOpen) {
        if (!(target instanceof HTMLElement) || !target.closest('.thought-capture')) return
        event.preventDefault()
        saveThoughtCapture()
        return
      }
      if (captureAction === 'newline') return

      if (event.key === 'Escape') {
        if (reorderMode) {
          setReorderMode(null)
          setNotice('Reorder mode cancelled.')
        } else if (commandOpen) setCommandOpen(false)
        else if (composerOpen) setComposerOpen(false)
        else if (sidebarOpen) setSidebarOpen(false)
        return
      }
      if (isTyping) return
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandQuery('')
        setCommandOpen(true)
      } else if (modifier && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openTaskEditor('create')
      } else if (modifier && event.key === '1') {
        event.preventDefault()
        setRoute('inbox')
      } else if (modifier && event.key === '2') {
        event.preventDefault()
        setRoute('today')
      } else if (modifier && event.key === '3') {
        event.preventDefault()
        setRoute('upcoming')
      } else if (event.key === '/') {
        event.preventDefault()
        document.querySelector('.global-search input')?.focus()
      } else if (event.key.toLowerCase() === 'm') {
        setSidebarOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [captureSession, commandOpen, composerOpen, projectDialogOpen, reorderMode, sidebarOpen, taskEditor])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 720px)')
    const syncBodyScroll = () => {
      document.body.classList.toggle('navigation-drawer-open', mediaQuery.matches && sidebarOpen)
    }
    syncBodyScroll()
    mediaQuery.addEventListener?.('change', syncBodyScroll)
    return () => {
      document.body.classList.remove('navigation-drawer-open')
      mediaQuery.removeEventListener?.('change', syncBodyScroll)
    }
  }, [sidebarOpen])

  useEffect(() => {
    if (!captureNotice) return
    const clearTimer = window.setTimeout(() => setCaptureNotice(''), 2600)
    return () => window.clearTimeout(clearTimer)
  }, [captureNotice])

  const navigate = (nextRoute) => {
    setReorderMode(null)
    setSectionComposerOpen(false)
    setRoute(nextRoute)
    setSelectedTask(null)
    if (window.matchMedia('(max-width: 720px)').matches) setSidebarOpen(false)
    notifyAndroidBackHandled(false)
  }

  useEffect(() => {
    const handleAndroidBack = () => {
      if (taskEditor) {
        setTaskEditor(null)
        notifyAndroidBackHandled(false)
        return
      }
      if (projectDialogOpen) {
        setProjectDialogOpen(false)
        setProjectToEdit(null)
        notifyAndroidBackHandled(false)
        return
      }
      if (captureSession?.isOpen) {
        dismissThoughtCapture()
        notifyAndroidBackHandled(false)
        return
      }
      if (commandOpen) {
        setCommandOpen(false)
        notifyAndroidBackHandled(false)
        return
      }
      if (selectedTask) {
        setSelectedTask(null)
        notifyAndroidBackHandled(false)
        return
      }
      if (sidebarOpen && window.matchMedia('(max-width: 720px)').matches) {
        setSidebarOpen(false)
        notifyAndroidBackHandled(false)
        return
      }
      if (route !== 'today') {
        navigate('today')
        notifyAndroidBackHandled(false)
        return
      }
      setNotice('Press Back again to exit Daymark.')
      notifyAndroidBackHandled(true)
    }
    window.addEventListener('daymark:android-back', handleAndroidBack)
    return () => window.removeEventListener('daymark:android-back', handleAndroidBack)
  }, [captureSession, commandOpen, projectDialogOpen, route, selectedTask, sidebarOpen, taskEditor])

  const enterReorderMode = (kind, id) => {
    if (kind === 'project' && !state.projects[id]) return
    if (kind === 'task' && (!state.tasks[id] || state.tasks[id].completedAt)) return
    if (kind === 'section' && !state.sections[id]) return
    setReorderMode({ kind, id })
    setNotice('')
  }

  const cancelReorderMode = (message = '') => {
    setReorderMode(null)
    if (message) setNotice(message)
  }

  const projectSections = (projectId) => Object.values(state.sections)
    .filter((section) => section.projectId === projectId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))

  const toggleSection = (sectionId, nextValue) => {
    if (!sectionId) return
    const result = appStore.dispatch({
      type: 'section.update',
      sectionId,
      patch: { isCollapsed: nextValue },
    })
    if (!result.ok) setNotice(result.message)
  }

  const moveSectionBy = (sectionId, direction) => {
    const current = state.sections[sectionId]
    if (!current) return
    const siblings = projectSections(current.projectId)
    const index = siblings.findIndex((section) => section.id === sectionId)
    const neighbor = siblings[index + direction]
    if (!neighbor) return
    const first = appStore.dispatch({
      type: 'section.update',
      sectionId: current.id,
      patch: { order: neighbor.order },
    })
    if (!first.ok) {
      setNotice(first.message)
      return
    }
    const second = appStore.dispatch({
      type: 'section.update',
      sectionId: neighbor.id,
      patch: { order: current.order },
    })
    if (!second.ok) setNotice(second.message)
    else if (reorderMode?.kind === 'section' && reorderMode.id === sectionId) {
      setNotice(`${current.name} moved ${direction < 0 ? 'earlier' : 'later'}. Use Escape or Done to leave reorder mode.`)
    }
  }

  const moveSectionToPointerTarget = (sectionId, event) => {
    const targetId = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-section-reorder-id]')
      ?.getAttribute('data-section-reorder-id')
    if (!targetId || targetId === sectionId || reorderPointerTargetRef.current === targetId) return
    const current = state.sections[sectionId]
    const target = state.sections[targetId]
    if (!current || !target || current.projectId !== target.projectId) return
    reorderPointerTargetRef.current = targetId
    appStore.dispatch({ type: 'section.update', sectionId, patch: { order: target.order } })
    appStore.dispatch({ type: 'section.update', sectionId: targetId, patch: { order: current.order } })
  }

  const createSection = (event) => {
    event.preventDefault()
    const name = sectionDraft.trim()
    const projectId = route.startsWith('project:') ? route.slice('project:'.length) : null
    if (!name || !projectId || !state.projects[projectId]) return
    const order = projectSections(projectId).reduce((highest, section) => Math.max(highest, section.order), -1) + 1
    const result = appStore.dispatch({
      type: 'section.add',
      input: { id: createId('section'), projectId, name, order },
    })
    if (!result.ok) {
      setNotice(result.message)
      return
    }
    setSectionDraft('')
    setSectionComposerOpen(false)
    setNotice(`Added ${name}.`)
  }

  const editProject = (project) => {
    setProjectToEdit(project)
    setProjectDialogOpen(true)
  }

  const addNote = (input) => {
    const result = appStore.dispatch({ type: 'note.add', input })
    if (!result.ok) setNotice(result.message)
  }

  const toggleNote = (noteId) => {
    const note = state.notes[noteId]
    if (!note) return
    const result = appStore.dispatch({
      type: note.completedAt ? 'note.uncomplete' : 'note.complete',
      noteId,
    })
    if (!result.ok) setNotice(result.message)
  }

  const moveNoteToTarget = (noteId, targetId) => {
    if (!targetId || targetId === noteId || reorderPointerTargetRef.current === targetId) return
    const current = state.notes[noteId]
    const target = state.notes[targetId]
    if (!current || !target) return
    reorderPointerTargetRef.current = targetId
    appStore.dispatch({ type: 'note.update', noteId, patch: { order: target.order } })
    appStore.dispatch({ type: 'note.update', noteId: targetId, patch: { order: current.order } })
  }

  const updateNote = (noteId, patch) => {
    const result = appStore.dispatch({ type: 'note.update', noteId, patch })
    if (!result.ok) setNotice(result.message)
  }

  const deleteNote = (noteId) => {
    const result = appStore.dispatch({ type: 'note.delete', noteId })
    if (!result.ok) setNotice(result.message)
  }

  const updateDiary = (date, patch) => {
    const result = appStore.dispatch({ type: 'diary.update', date, patch })
    if (!result.ok) setNotice(result.message)
  }

  const saveProject = (projectId, project) => {
    const result = appStore.dispatch({ type: 'project.update', projectId, patch: project })
    if (!result.ok) setNotice(result.message)
    setProjectDialogOpen(false)
    setProjectToEdit(null)
  }

  const moveProjectBy = (projectId, direction) => {
    const index = projectItems.findIndex((project) => project.id === projectId)
    const neighbor = projectItems[index + direction]
    const current = projectItems[index]
    if (!current || !neighbor) return
    const first = appStore.dispatch({
      type: 'project.update',
      projectId: current.id,
      patch: { order: neighbor.order },
    })
    if (!first.ok) {
      setNotice(first.message)
      return
    }
    const second = appStore.dispatch({
      type: 'project.update',
      projectId: neighbor.id,
      patch: { order: current.order },
    })
    if (!second.ok) setNotice(second.message)
    else if (reorderMode?.kind === 'project' && reorderMode.id === projectId) {
      setNotice(`${current.name} moved ${direction < 0 ? 'earlier' : 'later'}. Use Escape or Done to leave reorder mode.`)
    }
  }

  const moveProjectToTarget = (projectId, targetId) => {
    if (!targetId || targetId === projectId || reorderPointerTargetRef.current === targetId) return
    const current = projectItems.find((project) => project.id === projectId)
    const target = projectItems.find((project) => project.id === targetId)
    if (!current || !target) return
    reorderPointerTargetRef.current = targetId
    appStore.dispatch({ type: 'project.update', projectId, patch: { order: target.order } })
    appStore.dispatch({ type: 'project.update', projectId: targetId, patch: { order: current.order } })
  }

  const deleteProject = (project) => {
    const taskCount = Object.values(state.tasks).filter((task) => task.projectId === project.id).length
    const confirmed = window.confirm(
      `Delete "${project.name}"?\n\n${taskCount ? `${taskCount} associated task${taskCount === 1 ? '' : 's'} will be moved to Inbox and kept. Project sections will be removed.` : 'Any project sections will be removed.'}\n\nThis can be restored with Undo.`,
    )
    if (!confirmed) return
    const result = appStore.dispatch({ type: 'project.delete', projectId: project.id })
    if (!result.ok) {
      setNotice(result.message)
      return
    }
    setUndoAvailable(true)
    setNotice(`Deleted ${project.name}. Tasks were kept in Inbox.`)
    if (route === `project:${project.id}`) navigate('inbox')
  }

  const addOrderItem = (input) => {
    const result = appStore.dispatch({ type: 'order.add', input })
    if (!result.ok) setNotice(result.message)
  }

  const updateOrderItem = (itemId, patch) => {
    const result = appStore.dispatch({ type: 'order.update', itemId, patch })
    if (!result.ok) setNotice(result.message)
  }

  const deleteOrderItem = (item) => {
    if (!window.confirm(`Delete "${item.title}" from Order? Related items will lose only this relationship.`)) return
    const result = appStore.dispatch({ type: 'order.delete', itemId: item.id })
    if (!result.ok) setNotice(result.message)
  }

  const moveOrderItem = (itemId, swapId, laneId = null) => {
    const item = state.orderItems[itemId]
    const swap = state.orderItems[swapId]
    if (!item) return
    if (laneId && item.lane !== laneId) {
      appStore.dispatch({ type: 'order.update', itemId, patch: { lane: laneId, relationId: null } })
    }
    if (!swap) return
    appStore.dispatch({ type: 'order.update', itemId, patch: { order: swap.order, ...(laneId ? { lane: laneId, relationId: null } : {}) } })
    appStore.dispatch({ type: 'order.update', itemId: swap.id, patch: { order: item.order } })
  }

  const toggleTask = (taskId) => {
    const sourceTask = state.tasks[taskId]
    if (!sourceTask) return
    const result = appStore.dispatch({
      type: sourceTask.completedAt ? 'task.uncomplete' : 'task.complete',
      taskId,
    })
    if (!result.ok) setNotice(result.message)
    else {
      if (reorderMode?.kind === 'task' && reorderMode.id === taskId) setReorderMode(null)
      setNotice('')
      setUndoAvailable(false)
    }
  }

  const taskSiblings = (taskId) => {
    const task = state.tasks[taskId]
    if (!task || task.completedAt) return []
    return Object.values(state.tasks)
      .filter(
        (candidate) =>
          candidate.completedAt === null &&
          candidate.projectId === task.projectId &&
          (candidate.sectionId ?? null) === (task.sectionId ?? null),
      )
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  }

  const moveTaskBy = (taskId, direction) => {
    const siblings = taskSiblings(taskId)
    const index = siblings.findIndex((task) => task.id === taskId)
    const task = state.tasks[taskId]
    if (!task || index < 0 || !siblings[index + direction]) return
    const result = appStore.dispatch({
      type: 'task.reorder',
      input: { taskId, sectionId: task.sectionId, order: index + direction },
    })
    if (!result.ok) setNotice(result.message)
    else if (reorderMode?.kind === 'task' && reorderMode.id === taskId) {
      setNotice(`${task.content} moved ${direction < 0 ? 'earlier' : 'later'}. Use Escape or Done to leave reorder mode.`)
    }
  }

  const moveTaskToPointerTarget = (taskId, event) => {
    const targetId = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-reorder-id]')?.getAttribute('data-reorder-id')
    if (!targetId || targetId === taskId) return
    const siblings = taskSiblings(taskId)
    const targetIndex = siblings.findIndex((task) => task.id === targetId)
    if (targetIndex < 0 || reorderPointerTargetRef.current === targetId) return
    reorderPointerTargetRef.current = targetId
    const task = state.tasks[taskId]
    if (!task) return
    const result = appStore.dispatch({
      type: 'task.reorder',
      input: { taskId, sectionId: task.sectionId, order: targetIndex },
    })
    if (!result.ok) setNotice(result.message)
  }

  const finishPointerReorder = () => {
    reorderPointerTargetRef.current = null
    setReorderMode(null)
  }

  const submitTask = (event) => {
    event.preventDefault()
    const title = draft.trim()
    if (!title) return
    const requestedProjectId = route.startsWith('project:')
      ? route.slice('project:'.length)
      : route === 'inbox'
        ? state.preferences.inboxProjectId
        : 'project-work'
    const projectId = state.projects[requestedProjectId] ? requestedProjectId : state.preferences.inboxProjectId
    const sectionId = Object.values(state.sections).find((section) => section.projectId === projectId)?.id ?? null
    const labelId = state.labels['label-focus'] ? 'label-focus' : undefined
    const result = appStore.dispatch({
      type: 'task.add',
      input: {
        content: title,
        description: 'Newly captured in the Daymark shell.',
        projectId,
        sectionId,
        labelIds: labelId ? [labelId] : [],
        priority: 4,
        due: route === 'today' ? makeDue(toLocalDate(new Date())) : null,
      },
    })
    if (!result.ok) {
      setNotice(result.message)
      return
    }
    setNotice('')
    setUndoAvailable(false)
    setDraft('')
    setComposerOpen(false)
  }

  const openTaskEditor = (mode = 'create', task = null, scheduledDate = null) => {
    const fallbackProjectId = route.startsWith('project:')
      ? route.slice('project:'.length)
      : route === 'inbox'
        ? state.preferences.inboxProjectId
        : null
    const draft = task
      ? taskToTaskEditorDraft(task)
      : createTaskEditorDraft({
        projectId: fallbackProjectId,
        dueText: scheduledDate ?? (route === 'today' ? today : ''),
      })
    setComposerOpen(false)
    setSelectedTask(null)
    setTaskEditor({ mode, taskId: task?.id ?? null, draft })
  }

  agentBridgeActionsRef.current = { navigate, openTaskEditor }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const clone = (value) => {
      try {
        return structuredClone(value)
      } catch {
        return JSON.parse(JSON.stringify(value))
      }
    }
    const execute = (operation, payload) => {
      if (operation === 'getState') return { ok: true, state: clone(appStore.getState()) }
      if (operation === 'dispatch') return appStore.dispatch(payload)
      if (operation === 'navigate') {
        agentBridgeActionsRef.current?.navigate?.(payload?.route ?? 'today')
        return { ok: true }
      }
      if (operation === 'openTask') {
        const task = appStore.getState().tasks[payload?.taskId]
        if (!task) return { ok: false, reason: 'invalid', message: 'The requested task does not exist.' }
        agentBridgeActionsRef.current?.openTaskEditor?.('edit', task)
        return { ok: true }
      }
      if (operation === 'createTask') {
        agentBridgeActionsRef.current?.openTaskEditor?.('create', null, payload?.date ?? null)
        return { ok: true }
      }
      return { ok: false, reason: 'invalid', message: `Unknown Daymark agent operation: ${operation}` }
    }
    const publishResponse = (response, channel = null) => {
      channel?.postMessage(response)
      window.dispatchEvent(new CustomEvent('daymark:agent-response', { detail: response }))
    }
    const handleRequest = (event, channel = null) => {
      const request = event?.data ?? event?.detail
      if (!request || request.type !== 'daymark:agent-request') return
      publishResponse({
        type: 'daymark:agent-response',
        version: AGENT_BRIDGE_VERSION,
        requestId: request.requestId ?? null,
        result: execute(request.operation, request.payload),
      }, channel)
    }
    const channel = typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel('daymark-agent')
    if (channel) channel.addEventListener('message', (event) => handleRequest(event, channel))
    const onWindowRequest = (event) => handleRequest(event)
    window.addEventListener('daymark:agent-request', onWindowRequest)
    window.DaymarkAI = {
      version: AGENT_BRIDGE_VERSION,
      getState: () => clone(appStore.getState()),
      dispatch: (action) => execute('dispatch', action),
      navigate: (nextRoute) => execute('navigate', { route: nextRoute }),
      openTask: (taskId) => execute('openTask', { taskId }),
      createTask: (date = null) => execute('createTask', { date }),
    }
    window.dispatchEvent(new CustomEvent('daymark:agent-ready', {
      detail: { version: AGENT_BRIDGE_VERSION },
    }))
    const unsubscribe = appStore.subscribe((nextState) => {
      const update = {
        type: 'daymark:agent-state',
        version: AGENT_BRIDGE_VERSION,
        state: clone(nextState),
      }
      channel?.postMessage(update)
      window.dispatchEvent(new CustomEvent('daymark:agent-state', { detail: update }))
    })
    return () => {
      unsubscribe()
      channel?.close()
      window.removeEventListener('daymark:agent-request', onWindowRequest)
      if (window.DaymarkAI?.version === AGENT_BRIDGE_VERSION) delete window.DaymarkAI
    }
  }, [])

  const saveTaskEditor = (draft) => {
    if (!taskEditor) return
    const context = { today, inboxProjectId: state.preferences.inboxProjectId }
    const adapted = taskEditor.mode === 'edit'
      ? taskEditorDraftToTaskPatch(draft, context)
      : taskEditorDraftToTaskInput(draft, context)
    if (!adapted.ok) {
      setNotice(Object.values(adapted.errors).find(Boolean) ?? 'Check the task details and try again.')
      return
    }
    const result = taskEditor.mode === 'edit'
      ? appStore.dispatch({ type: 'task.update', taskId: taskEditor.taskId, patch: adapted.value })
      : appStore.dispatch({ type: 'task.add', input: adapted.value })
    if (!result.ok) {
      setNotice(result.message)
      return
    }
    setNotice('')
    setUndoAvailable(false)
    setTaskEditor(null)
  }

  const moveTaskToDate = (taskId, date) => {
    const task = state.tasks[taskId]
    if (!task) return
    const movement = buildMovedTask(task, date)
    if (!movement.ok) {
      setNotice('That task could not be moved to the selected day.')
      return
    }
    const result = appStore.dispatch({
      type: 'task.update',
      taskId,
      patch: { due: movement.task.due },
    })
    if (!result.ok) {
      setNotice(result.message)
      setUndoAvailable(false)
    } else {
      setNotice(`Moved task to ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(fromLocalDate(date))}.`)
      setUndoAvailable(true)
    }
  }

  const undoLastChange = () => {
    const result = appStore.dispatch({ type: 'undo' })
    if (!result.ok) {
      setNotice(result.message)
      setUndoAvailable(false)
      return
    }
    setNotice('Last change undone.')
    setUndoAvailable(false)
  }

  const createProject = ({ project, defaultSectionName }) => {
    const projectId = createId('project')
    const result = appStore.dispatch({
      type: 'project.add',
      input: {
        id: projectId,
        ...project,
      },
    })
    if (!result.ok) {
      setNotice(result.message)
      return
    }
    if (defaultSectionName) {
      const sectionResult = appStore.dispatch({
        type: 'section.add',
        input: { id: createId('section'), projectId, name: defaultSectionName },
      })
      if (!sectionResult.ok) {
        setNotice(`Project created, but its default section could not be added: ${sectionResult.message}`)
      }
    }
    setProjectDialogOpen(false)
    navigate(`project:${projectId}`)
  }

  const utilityAction = (action) => {
    if (action === 'compose') {
      openTaskEditor('create')
      return
    }
    if (action === 'capture') {
      openThoughtCapture()
      return
    }
    navigate(action)
  }

  const updateThemePreference = (theme) => {
    setPreference(theme)
    appStore.dispatch({ type: 'preferences.update', patch: { theme } })
  }

  const updateUiSettings = (patch) => {
    if (typeof patch.showCompleted === 'boolean') {
      appStore.dispatch({ type: 'preferences.update', patch: { showCompleted: patch.showCompleted } })
    }
    const next = { ...uiSettings, ...patch }
    delete next.showCompleted
    setUiSettings(next)
    writeUiSettings(next)
  }

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(appStore.getState(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `daymark-backup-${toLocalDate(new Date())}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('Backup exported.')
  }

  const importBackup = async (file) => {
    try {
      const text = await file.text()
      const parsed = loadState({ read: () => text, write: () => undefined })
      if (parsed.recovered) {
        setNotice('That backup is malformed or from an unsupported Daymark version. Nothing was changed.')
        return
      }
      const imported = parsed.state
      const confirmed = window.confirm('Replace this browser workspace with the imported backup?')
      if (!confirmed) return
      createBrowserStorage().write(JSON.stringify(imported))
      appStore.reload()
      setReorderMode(null)
      setRoute('today')
      setNotice('Backup imported.')
    } catch {
      setNotice('That backup could not be imported. Choose a Daymark JSON export.')
    }
  }

  const resetWorkspace = () => {
    if (!window.confirm('Reset this local workspace? Export a backup first if you may need this data.')) return
    createBrowserStorage().remove?.()
    appStore.reset()
    setReorderMode(null)
    setRoute('today')
    setNotice('Local workspace reset.')
  }

  return (
    <div className={`app-shell density-${uiSettings.density} text-scale-${uiSettings.textScale} ${sidebarOpen ? '' : 'sidebar-is-collapsed'}`}>
      <CalendarIntegrationStyle />
      <header className="topbar">
        <div className="topbar__brand">
          <button
            aria-controls="primary-navigation"
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
            className="icon-button topbar__menu"
            onClick={() => setSidebarOpen((open) => !open)}
            title={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
            type="button"
          >
            <Icon name="menu" size={18} />
          </button>
          <button className="brand-lockup" onClick={() => navigate('today')} type="button">
            <LogoMark />
            <span>Daymark</span>
          </button>
          <a aria-label="Open Daymark on GitHub" className="github-link" href={GITHUB_URL} rel="noreferrer" target="_blank" title="Open GitHub repository">
            <Icon name="github" size={16} />
          </a>
        </div>

        <div className="topbar__controls">
          <label className="global-search">
            <Icon name="search" size={17} />
            <input aria-label="Search tasks and views" onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search your workspace" type="search" value={searchTerm} />
            <kbd>/</kbd>
          </label>
          <button aria-label="Open command palette" className="icon-button" onClick={() => setCommandOpen(true)} title="Command palette (Ctrl K)" type="button">
            <Icon name="command" size={17} />
          </button>
          <span className="topbar__divider" />
          <button className="avatar-button" title="Open profile menu" type="button">ML</button>
        </div>
      </header>

      <div className="shell-grid">
        <aside className="sidebar" id="primary-navigation" aria-label="Primary navigation">
          <div className="sidebar__scroll">
            <SidebarSection title="WORKSPACE">
              {NAV_ITEMS.map((item) => (
                <SidebarRow
                  active={route === item.id}
                  count={item.id === 'today'
                    ? tasks.filter((task) => state.tasks[task.id]?.due?.date === today && !task.completed).length
                    : item.id === 'inbox'
                      ? tasks.filter((task) => task.project === state.preferences.inboxProjectId && !task.completed).length
                      : item.id === 'upcoming'
                      ? tasks.filter((task) => state.tasks[task.id]?.due?.date >= today && !task.completed).length
                        : item.id === 'completed'
                          ? tasks.filter((task) => task.completed).length
                          : item.id === 'order'
                            ? orderItems.length
                          : item.id === 'notes'
                            ? journal.notes.length
                            : Object.keys(journal.diaryEntries).length}
                  icon={item.icon}
                  key={item.id}
                  label={item.label}
                  onClick={() => navigate(item.id)}
                  shortcut={item.id === 'today' ? 'Ctrl 2' : undefined}
                />
              ))}
            </SidebarSection>

            <SidebarSection
              title="PROJECTS"
              action={
                <button aria-label="Add project" className="section-action" onClick={() => setProjectDialogOpen(true)} title="Add project" type="button">
                  <Icon name="plus" size={15} />
                </button>
              }
            >
              {projectItems.map((project, index) => (
                <ProjectSidebarItem
                  active={route === `project:${project.id}`}
                  canMoveEarlier={index > 0}
                  canMoveLater={index < projectItems.length - 1}
                  count={tasks.filter((task) => task.project === project.id && !task.completed).length}
                  isReordering={reorderMode?.kind === 'project' && reorderMode.id === project.id}
                  key={project.id}
                  onClick={() => navigate(`project:${project.id}`)}
                  onCancelReorder={() => cancelReorderMode()}
                  onDelete={() => deleteProject(project)}
                  onEdit={() => editProject(project)}
                  onLongPressReorder={() => enterReorderMode('project', project.id)}
                  onReorderMove={(projectId, event) => moveProjectToTarget(projectId, document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-reorder-id]')?.getAttribute('data-reorder-id'))}
                  onReorderEnd={finishPointerReorder}
                  onMoveEarlier={() => moveProjectBy(project.id, -1)}
                  onMoveLater={() => moveProjectBy(project.id, 1)}
                  project={project}
                />
              ))}
            </SidebarSection>

            <SidebarSection
              title="TAGS"
              action={
                <button aria-label="Add tag" className="section-action" title="Add tag" type="button">
                  <Icon name="plus" size={15} />
                </button>
              }
            >
              {labelItems.map((label) => (
                <SidebarRow
                  active={route === `label:${label.id}`}
                  count={tasks.filter((task) => task.tag === label.id && !task.completed).length}
                  icon="tag"
                  key={label.id}
                  label={label.name}
                  onClick={() => navigate(`label:${label.id}`)}
                />
              ))}
            </SidebarSection>
          </div>
          <div className="sidebar__footer">
            <SidebarRow active={route === 'settings'} icon="settings" label="Settings" onClick={() => navigate('settings')} />
            <span className="sidebar__version">LOCAL SHELL 0.1</span>
          </div>
        </aside>
        {sidebarOpen ? (
          <button
            aria-label="Close navigation"
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
        ) : null}

        <main className="main-content">
          <div className="content-frame">
            <div className="view-header">
              <div>
                <span className="section-kicker">{routeInfo.kicker}</span>
                <h1>{routeInfo.title}</h1>
                <p>{routeInfo.subtitle}</p>
              </div>
              <div className="view-header__actions">
                {!['upcoming', 'order', 'notes', 'diary'].includes(route) ? (
                  <div aria-label="View mode" className="segmented-control" role="group">
                    <button className={viewMode === 'list' ? 'is-selected' : ''} onClick={() => setViewMode('list')} title="List view" type="button">
                      <Icon name="list" size={16} />
                      List
                    </button>
                    <button className={viewMode === 'board' ? 'is-selected' : ''} onClick={() => setViewMode('board')} title="Board view" type="button">
                      <Icon name="board" size={16} />
                      Board
                    </button>
                  </div>
                ) : null}
                {!['order', 'notes', 'diary'].includes(route) ? <button className="primary-button" onClick={() => openTaskEditor('create', null, route === 'upcoming' ? selectedCalendarDate : null)} type="button">
                  <Icon name="plus" size={17} />
                  Add task
                </button> : null}
              </div>
            </div>

            {searchTerm ? (
              <div className="search-summary">
                <span>
                  Showing <strong>{visibleTasks.length}</strong> matches for “{searchTerm}”
                </span>
                <button className="text-button" onClick={() => setSearchTerm('')} type="button">
                  Clear search
                </button>
              </div>
            ) : null}

            {notice ? (
              <div className="shell-notice" role="status">
                <span>{notice}</span>
                <span>
                  {undoAvailable ? <button className="text-button" onClick={undoLastChange} type="button">Undo</button> : null}
                  <button className="text-button" onClick={() => { setNotice(''); setUndoAvailable(false) }} type="button">
                    Dismiss
                  </button>
                </span>
              </div>
            ) : null}

            {reorderMode ? (
              <div aria-live="polite" className="reorder-mode-banner" id="reorder-mode-help" role="status">
                <span>
                  <strong>Reorder mode</strong>
                  {' '}
                  {reorderMode.kind === 'project'
                    ? state.projects[reorderMode.id]?.name
                    : reorderMode.kind === 'section'
                      ? state.sections[reorderMode.id]?.name
                      : state.tasks[reorderMode.id]?.content}
                  {' '}selected. Use the Move earlier or Move later controls.
                </span>
                <button className="text-button" onClick={() => cancelReorderMode()} type="button">Done</button>
              </div>
            ) : null}

            {route === 'settings' ? (
              <SettingsPanel
                onExport={exportBackup}
                onImport={importBackup}
                onReset={resetWorkspace}
                onCopySyncLink={copySyncLink}
                onThemeChange={updateThemePreference}
                onUiSettingsChange={updateUiSettings}
                settings={uiSettings}
                state={state}
                syncAndroidLink={getAndroidSyncLink(syncKey)}
                syncKey={syncKey}
                syncLink={getSyncLink(syncKey)}
                syncStatus={syncStatus}
              />
            ) : route === 'order' ? (
              <OrderWorkspace items={orderItems} onAdd={addOrderItem} onDelete={deleteOrderItem} onMove={moveOrderItem} onUpdate={updateOrderItem} />
            ) : route === 'notes' || route === 'diary' ? (
              <JournalView
                journal={journal}
                onDiaryUpdate={updateDiary}
                onNoteAdd={addNote}
                onNoteComplete={toggleNote}
                onNoteDelete={deleteNote}
                onNoteMove={moveNoteToTarget}
                onNoteUpdate={updateNote}
                route={route}
              />
            ) : route === 'upcoming' ? (
              <>
              <IntegratedUpcomingCalendar
                initialMode="month"
                onDateSelect={setSelectedCalendarDate}
                onTaskAdd={(date) => openTaskEditor('create', null, date)}
                onTaskEdit={(taskId) => openTaskEditor('edit', state.tasks[taskId])}
                onTaskMove={moveTaskToDate}
                onTaskToggle={toggleTask}
                selectedDate={selectedCalendarDate}
                weekStartsOn={uiSettings.weekStartsOn === 'sunday' ? 0 : 1}
                  tasks={calendarTasks
                  .filter((task) => {
                    if (!task.due?.date) return false
                    if (!searchTerm.trim()) return true
                    const project = state.projects[task.projectId]
                    const labels = task.labelIds.map((labelId) => state.labels[labelId]?.name ?? '').join(' ')
                    const query = searchTerm.trim().toLowerCase()
                    return `${task.content} ${task.description} ${project?.name ?? ''} ${labels}`.toLowerCase().includes(query)
                  })
                  .map((task) => ({
                    id: task.id,
                    title: task.content,
                    dueDate: task.due.date,
                    completed: Boolean(task.completedAt),
                    projectName: state.projects[task.projectId]?.name,
                    projectColor: ({ teal: '#267553', amber: '#b77b28', indigo: '#505caa', charcoal: '#4c5652' })[state.projects[task.projectId]?.color] ?? '#267553',
                  }))}
              />
              <details className="upcoming-plan-tray">
                <summary>Plan tray <span>{calendarTasks.filter((task) => !task.completedAt && (!task.due?.date || task.due.date < today)).length}</span></summary>
                <div>
                  {calendarTasks.filter((task) => !task.completedAt && (!task.due?.date || task.due.date < today)).length ? (
                    calendarTasks
                      .filter((task) => !task.completedAt && (!task.due?.date || task.due.date < today))
                      .map((task) => (
                        <button key={task.id} onClick={() => openTaskEditor('edit', task)} type="button">
                          <span className={`project-dot project-dot--${PROJECT_COLORS[state.projects[task.projectId]?.color] ?? 'teal'}`} />
                          <span>{task.content}</span>
                          <small>{task.due?.date ? 'Overdue' : 'Unscheduled'}</small>
                        </button>
                      ))
                  ) : <p>Nothing needs rescheduling.</p>}
                </div>
              </details>
              </>
            ) : (
            <div className="task-canvas">
              <div className="canvas-toolbar">
                <div className="canvas-toolbar__label">
                  <Icon name="focus" size={17} />
                  <span>{route === 'today' ? 'Focus lane' : 'Active tasks'}</span>
                  <span className="canvas-toolbar__count">{visibleTasks.filter((task) => !task.completed).length}</span>
                </div>
                <div className="canvas-toolbar__actions">
                  {route.startsWith('project:') ? (
                    <button
                      aria-expanded={sectionComposerOpen}
                      className="toolbar-button"
                      onClick={() => {
                        setSectionComposerOpen((open) => !open)
                        setNotice('')
                      }}
                      title="Add a section"
                      type="button"
                    >
                      <Icon name="plus" size={15} />
                      Add section
                    </button>
                  ) : null}
                  <button className="toolbar-button" title="Filter and sort tasks" type="button">
                    <Icon name="filter" size={15} />
                    Sort
                  </button>
                </div>
              </div>

              {route.startsWith('project:') && sectionComposerOpen ? (
                <form className="section-composer" onSubmit={createSection}>
                  <label htmlFor="section-name">New section</label>
                  <input
                    autoFocus
                    id="section-name"
                    onChange={(event) => setSectionDraft(event.target.value)}
                    placeholder="e.g. Ready for review"
                    value={sectionDraft}
                  />
                  <button className="primary-button" disabled={!sectionDraft.trim()} type="submit">
                    <Icon name="check" size={15} />
                    Add section
                  </button>
                  <button className="secondary-button" onClick={() => setSectionComposerOpen(false)} type="button">
                    Cancel
                  </button>
                </form>
              ) : null}

              {viewMode === 'list' ? (
                <div className="task-list">
                  {sections.length ? (
                    sections.map((section) => (
                      <section className={`task-section ${reorderMode?.kind === 'section' && reorderMode.id === section.id ? 'is-reordering' : ''}`} key={section.id ?? section.name}>
                        <SectionHeading
                          canMoveEarlier={Boolean(section.id && projectSections(section.projectId).findIndex((candidate) => candidate.id === section.id) > 0)}
                          canMoveLater={Boolean(section.id && (() => {
                            const index = projectSections(section.projectId).findIndex((candidate) => candidate.id === section.id)
                            return index >= 0 && index < projectSections(section.projectId).length - 1
                          })())}
                          collapsed={Boolean(section.id && state.sections[section.id]?.isCollapsed)}
                          count={section.tasks.length}
                          isReordering={reorderMode?.kind === 'section' && reorderMode.id === section.id}
                          onLongPressReorder={route.startsWith('project:') && section.id ? () => enterReorderMode('section', section.id) : undefined}
                          onMoveEarlier={() => moveSectionBy(section.id, -1)}
                          onMoveLater={() => moveSectionBy(section.id, 1)}
                          onReorderEnd={finishPointerReorder}
                          onReorderMove={moveSectionToPointerTarget}
                          onToggle={section.id ? toggleSection : undefined}
                          section={section}
                        />
                        {!section.id || !state.sections[section.id]?.isCollapsed ? section.tasks.map((task) => {
                          const siblings = taskSiblings(task.id)
                          const siblingIndex = siblings.findIndex((candidate) => candidate.id === task.id)
                          return (
                            <TaskRow
                              canMoveEarlier={siblingIndex > 0}
                              canMoveLater={siblingIndex >= 0 && siblingIndex < siblings.length - 1}
                              isReordering={reorderMode?.kind === 'task' && reorderMode.id === task.id}
                              key={task.id}
                              onCancelReorder={() => cancelReorderMode()}
                              onLongPressReorder={task.completed ? undefined : () => enterReorderMode('task', task.id)}
                              onReorderMove={moveTaskToPointerTarget}
                              onReorderEnd={finishPointerReorder}
                              onMoveEarlier={() => moveTaskBy(task.id, -1)}
                              onMoveLater={() => moveTaskBy(task.id, 1)}
                              onOpen={(viewTask) => openTaskEditor('edit', state.tasks[viewTask.id])}
                              onToggle={toggleTask}
                              task={task}
                            />
                          )
                        }) : null}
                      </section>
                    ))
                  ) : (
                    <div className="empty-state">
                      <span className="empty-state__icon"><Icon name="focus" size={22} /></span>
                      <h2>No tasks in this view</h2>
                      <p>Add a task here or choose another view from the navigation rail.</p>
                      <button className="secondary-button" onClick={() => openTaskEditor('create')} type="button">
                        <Icon name="plus" size={16} />
                        Add the next step
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="board-view">
                  {(sections.length ? sections : [{ id: null, name: 'Focus lane', tasks: [] }]).map((section) => (
                    <section
                      className="board-column"
                      key={section.id ?? section.name}
                      onDragOver={(event) => {
                        if (event.dataTransfer.types.includes('text/plain')) {
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const taskId = event.dataTransfer.getData('text/plain')
                        const task = state.tasks[taskId]
                        if (!task || task.completedAt) return
                        const result = appStore.dispatch({
                          type: 'task.reorder',
                          input: { taskId, sectionId: section.id ?? null, order: section.tasks.length },
                        })
                        if (!result.ok) setNotice(result.message)
                      }}
                    >
                      <SectionHeading
                        canMoveEarlier={Boolean(section.id && projectSections(section.projectId).findIndex((candidate) => candidate.id === section.id) > 0)}
                        canMoveLater={Boolean(section.id && (() => {
                          const index = projectSections(section.projectId).findIndex((candidate) => candidate.id === section.id)
                          return index >= 0 && index < projectSections(section.projectId).length - 1
                        })())}
                        count={section.tasks.length}
                        isReordering={reorderMode?.kind === 'section' && reorderMode.id === section.id}
                        onLongPressReorder={route.startsWith('project:') && section.id ? () => enterReorderMode('section', section.id) : undefined}
                        onMoveEarlier={() => moveSectionBy(section.id, -1)}
                        onMoveLater={() => moveSectionBy(section.id, 1)}
                        onReorderEnd={finishPointerReorder}
                        onReorderMove={moveSectionToPointerTarget}
                        section={section}
                        variant="board"
                      />
                      <div className="board-column__body">
                        {section.tasks.map((task) => (
                          <article
                            className={`board-task ${task.completed ? 'is-completed' : ''}`}
                            draggable={!task.completed}
                            key={task.id}
                            onDragStart={(event) => {
                              if (!task.completed) {
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', task.id)
                              }
                            }}
                          >
                            <button
                              aria-label={task.completed ? `Restore ${task.title}` : `Complete ${task.title}`}
                              className="board-task__complete"
                              onClick={() => toggleTask(task.id)}
                              title={task.completed ? 'Restore task' : 'Complete task'}
                              type="button"
                            >
                              <Icon name={task.completed ? 'check' : 'circle'} size={14} />
                            </button>
                            <button className="board-task__body" onClick={() => openTaskEditor('edit', state.tasks[task.id])} type="button">
                              <span className={`board-task__priority board-task__priority--${task.priorityTone}`} />
                              <strong>{task.title}</strong>
                              <small>{task.due}</small>
                            </button>
                          </article>
                        ))}
                        <button className="board-add" onClick={() => openTaskEditor('create')} type="button">
                          <Icon name="plus" size={15} />
                          Add task
                        </button>
                      </div>
                    </section>
                  ))}
                </div>
              )}

              {composerOpen ? (
                <TaskComposer inputRef={composerRef} onCancel={() => setComposerOpen(false)} onChange={setDraft} onSubmit={submitTask} value={draft} />
              ) : (
                <button className="empty-composer" onClick={() => openTaskEditor('create')} type="button">
                  <Icon name="plus" size={18} />
                  <span>Add task</span>
                  <kbd>Ctrl N</kbd>
                </button>
              )}
            </div>
            )}
          </div>
        </main>

        <UtilityPanel onAction={utilityAction} />
      </div>

      {selectedTask ? (
        <aside className="task-preview" aria-label="Task preview">
          <div className="task-preview__heading">
            <span className="section-kicker">TASK PREVIEW</span>
            <button aria-label="Close task preview" className="icon-button" onClick={() => setSelectedTask(null)} title="Close" type="button">
              <Icon name="close" size={17} />
            </button>
          </div>
          <h2>{selectedTask.title}</h2>
          <p>{selectedTask.note}</p>
          <div className="task-preview__meta">
            <span className="meta-pill"><Icon name="calendar" size={14} />{selectedTask.due}</span>
            <span className="meta-pill"><Icon name="folder" size={14} />{selectedTask.projectName}</span>
            <span className="meta-pill"><Icon name="tag" size={14} />{selectedTask.tagName || 'No tag'}</span>
          </div>
          <button className="secondary-button task-preview__complete" onClick={() => { toggleTask(selectedTask.id); setSelectedTask(null) }} type="button">
            <Icon name="focus" size={16} />
            {selectedTask.completed ? 'Mark active' : 'Complete task'}
          </button>
        </aside>
      ) : null}

      {commandOpen ? (
        <CommandPalette
          onCapture={openThoughtCapture}
          onClose={() => setCommandOpen(false)}
          onCompose={() => openTaskEditor('create')}
          onNavigate={navigate}
          onQueryChange={setCommandQuery}
          query={commandQuery}
        />
      ) : null}

      <ThoughtCaptureTray
        onChange={updateThoughtCapture}
        onDiscard={discardThoughtCapture}
        onDismiss={dismissThoughtCapture}
        onSave={saveThoughtCapture}
        session={captureSession}
      />
      {captureNotice ? (
        <div aria-live="polite" className="thought-capture-toast" role="status">
          <Icon name="note" size={15} />
          <span>{captureNotice}</span>
        </div>
      ) : null}

      <TaskEditor
        draft={taskEditor?.draft ?? createTaskEditorDraft()}
        isOpen={Boolean(taskEditor)}
        labels={toTaskEditorLabelOptions(Object.values(state.labels))}
        mode={taskEditor?.mode ?? 'create'}
        onClose={() => setTaskEditor(null)}
        onDraftChange={(draft) => setTaskEditor((editor) => editor ? { ...editor, draft } : editor)}
        onRequestProjectPicker={() => setProjectDialogOpen(true)}
        onSave={saveTaskEditor}
        presentation="dialog"
        projects={toTaskEditorProjectOptions(Object.values(state.projects))}
        sections={toTaskEditorSectionOptions(Object.values(state.sections), taskEditor?.draft.projectId ?? null)}
      />

      <ProjectCreateDialog
        isOpen={projectDialogOpen}
        onCancel={() => {
          setProjectDialogOpen(false)
          setProjectToEdit(null)
        }}
        onCreate={createProject}
        onSave={saveProject}
        project={projectToEdit}
      />
    </div>
  )
}

export default App
