import { createClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { addDays, fromLocalDate, toLocalDate } from '../core/dates'
import { createId } from '../core/sample-data'
import { createAppStore } from '../core/store'
import { createBrowserStorage } from '../core/storage'
import { createLocalRepository } from '../core/repository'
import { createAuthService, createSupabaseBrowserClient, readPublicCloudEnvironment } from '../core/cloud'
import { UpcomingCalendar as IntegratedUpcomingCalendar } from '../features/calendar/UpcomingCalendar'
import { moveTaskToDate as buildMovedTask } from '../features/calendar/task-movement'
import '../features/calendar/upcoming-calendar.css'
import '../features/calendar/calendar-task-chips.css'
import { ProjectCreateDialog } from '../features/projects/ProjectCreateDialog'
import '../features/projects/project-create-dialog.css'
import { AccountDialog, AuthDialog } from '../features/auth'
import { CollaborationDialog } from '../features/collaboration'
import { SearchDialog, buildSearchRecords } from '../features/search'
import { createReminderToast, scheduleTaskReminders, ToastViewport, useReminderPreferences, useReminderScheduler } from '../features/reminders'
import { installPrompt, serviceWorkerUpdate } from '../pwa/register-service-worker'
import { ConflictDialog } from './conflict-dialog'
import { RepositoryProvider } from './repository-context'
import { SyncStatus } from './sync-status'
import { useDaymarkApp } from './use-daymark-app'
import {
  TaskEditor,
  createTaskEditorDraft,
  taskEditorDraftToTaskInput,
  taskEditorDraftToTaskPatch,
  taskToTaskEditorDraft,
  toTaskEditorLabelOptions,
  toTaskEditorProjectOptions,
  toTaskEditorSectionOptions,
} from '../features/task-editor'

const NAV_ITEMS = [
  { id: 'today', label: 'Today', icon: 'sun', count: 5 },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', count: 4 },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar', count: 7 },
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

const appStore = createAppStore(createBrowserStorage())
const repository = createLocalRepository(appStore)

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
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
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

function TaskRow({ task, onToggle, onOpen }) {
  return (
    <article className={`task-row ${task.completed ? 'is-completed' : ''}`}>
      <button
        aria-label={task.completed ? `Mark ${task.title} active` : `Complete ${task.title}`}
        className="task-check"
        onClick={() => onToggle(task.id)}
        title={task.completed ? 'Mark active' : 'Complete task'}
        type="button"
      >
        {task.completed ? <span>✓</span> : null}
      </button>
      <button className="task-row__body" onClick={() => onOpen(task)} type="button">
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
        <button aria-label={`More actions for ${task.title}`} className="icon-button task-more" title="More actions" type="button">
          <Icon name="more" size={16} />
        </button>
      </span>
    </article>
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
          <span className="section-kicker">ORGANIZE</span>
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
        <button onClick={() => onAction('inbox')} type="button">
          <Icon name="note" size={17} />
          Capture a note
        </button>
        <button onClick={() => onAction('today')} type="button">
          <Icon name="focus" size={17} />
          Return to focus
        </button>
      </div>
    </aside>
  )
}

function CommandPalette({ query, onQueryChange, onClose, onNavigate, onCompose }) {
  const commands = [
    { id: 'today', label: 'Open Today', detail: 'See your current focus lane', shortcut: 'Ctrl 2' },
    { id: 'inbox', label: 'Open Inbox', detail: 'Review uncategorized tasks', shortcut: 'Ctrl 1' },
    { id: 'upcoming', label: 'Open Upcoming', detail: 'Plan the next few days', shortcut: 'Ctrl 3' },
    { id: 'compose', label: 'Add a task', detail: 'Capture something new', shortcut: 'Ctrl N' },
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

function getRouteInfo(route, state) {
  if (route === 'inbox') {
    return { title: 'Inbox', kicker: 'CAPTURED WORK', subtitle: 'A quiet place to sort what just arrived.' }
  }
  if (route === 'upcoming') {
    return { title: 'Upcoming', kicker: 'NEXT HORIZON', subtitle: 'A clear runway for the days ahead.' }
  }
  if (route.startsWith('project:')) {
    const project = state.projects[route.slice('project:'.length)]
    return { title: project?.name ?? 'Project', kicker: 'PROJECT VIEW', subtitle: 'Keep the next useful step visible.' }
  }
  if (route.startsWith('label:')) {
    const tag = state.labels[route.slice('label:'.length)]
    return { title: tag?.name ?? 'Tag', kicker: 'SAVED VIEW', subtitle: 'A focused lens across your work.' }
  }
  return { title: 'Today', kicker: 'SUNDAY, AUGUST 2', subtitle: 'A clear view of what matters now.' }
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

function DaymarkShell() {
  const { state, isOnline, offlineError } = useDaymarkApp(repository)
  const [route, setRoute] = useState('today')
  const [viewMode, setViewMode] = useState('list')
  const [composerOpen, setComposerOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedTask, setSelectedTask] = useState(null)
  const [notice, setNotice] = useState('')
  const [undoAvailable, setUndoAvailable] = useState(false)
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => toLocalDate(new Date()))
  const [taskEditor, setTaskEditor] = useState(null)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [conflictMessage, setConflictMessage] = useState('')
  const [collaborationOpen, setCollaborationOpen] = useState(false)
  const [collaborationMembers, setCollaborationMembers] = useState([
    { id: 'member-local', email: 'local@daymark.app', displayName: 'You', role: 'owner', invitationStatus: 'accepted' },
  ])
  const [toasts, setToasts] = useState([])
  const [reminderPreferences] = useReminderPreferences()
  const composerRef = useRef(null)
  const installState = useSyncExternalStore(installPrompt.subscribe, installPrompt.getState, installPrompt.getState)
  const updateState = useSyncExternalStore(serviceWorkerUpdate.subscribe, serviceWorkerUpdate.getState, serviceWorkerUpdate.getState)
  const cloudClient = useMemo(() => {
    try {
      return createSupabaseBrowserClient(readPublicCloudEnvironment(), createClient)
    } catch {
      return null
    }
  }, [])
  const cloudAuth = useMemo(() => cloudClient ? createAuthService(cloudClient.auth) : null, [cloudClient])

  useEffect(() => {
    seedDemoWorkspace()
  }, [])

  const tasks = useMemo(
    () => Object.values(state.tasks).map((task) => toViewTask(task, state)),
    [state],
  )
  const calendarTasks = useMemo(() => Object.values(state.tasks), [state.tasks])
  const searchRecords = useMemo(() => buildSearchRecords(state), [state])
  const reminders = useMemo(
    () => scheduleTaskReminders(calendarTasks, new Date(), reminderPreferences.dueSoonMinutes * 60_000)
      .filter((schedule) => schedule.remindAt)
      .map((schedule) => ({
        id: schedule.id,
        remindAt: schedule.remindAt,
        taskId: schedule.taskId,
        taskTitle: state.tasks[schedule.taskId]?.content ?? 'Task',
      })),
    [calendarTasks, reminderPreferences.dueSoonMinutes, state.tasks],
  )
  const today = toLocalDate(new Date())
  const projectItems = useMemo(
    () =>
      Object.values(state.projects)
        .filter((project) => project.id !== state.preferences.inboxProjectId && !project.isArchived)
        .sort((left, right) => left.order - right.order),
    [state],
  )
  const labelItems = useMemo(
    () => Object.values(state.labels).sort((left, right) => left.order - right.order),
    [state],
  )
  const routeInfo = getRouteInfo(route, state)
  const visibleTasks = useMemo(() => {
    if (searchTerm.trim()) {
      const query = searchTerm.trim().toLowerCase()
      return tasks.filter((task) => `${task.title} ${task.note} ${task.priority} ${task.projectName} ${task.tagName}`.toLowerCase().includes(query))
    }
    let scoped = tasks
    if (route === 'inbox') scoped = tasks.filter((task) => task.project === state.preferences.inboxProjectId)
    if (route === 'upcoming') scoped = tasks.filter((task) => state.tasks[task.id]?.due?.date >= today)
    if (route.startsWith('project:')) scoped = tasks.filter((task) => task.project === route.slice('project:'.length))
    if (route.startsWith('label:')) scoped = tasks.filter((task) => task.tag === route.slice('label:'.length))
    if (route === 'today') scoped = tasks.filter((task) => state.tasks[task.id]?.due?.date === today)
    return scoped
  }, [route, searchTerm, state.preferences.inboxProjectId, state.tasks, tasks, today])

  const sections = useMemo(() => {
    const names = [...new Set(visibleTasks.map((task) => task.section))]
    return names.map((name) => ({ name, tasks: visibleTasks.filter((task) => task.section === name) }))
  }, [visibleTasks])

  useReminderScheduler(reminders, {
    onDue: (reminder) => {
      if (!reminderPreferences.inAppNotifications) return
      setToasts((current) => [
        ...current.filter((toast) => toast.id !== `reminder:${reminder.id}`),
        createReminderToast(reminder),
      ])
    },
  })

  useEffect(() => {
    if (composerOpen) {
      window.setTimeout(() => composerRef.current?.focus(), 0)
    }
  }, [composerOpen])

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      const isTyping = target instanceof HTMLElement && Boolean(target.closest('input, textarea, [contenteditable="true"]'))
      const modifier = event.ctrlKey || event.metaKey

      if (event.key === 'Escape') {
        if (commandOpen) setCommandOpen(false)
        else if (composerOpen) setComposerOpen(false)
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
  }, [commandOpen, composerOpen])

  const navigate = (nextRoute) => {
    setRoute(nextRoute)
    setSelectedTask(null)
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
      setNotice('')
      setUndoAvailable(false)
    }
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
    navigate(action)
  }

  const runAuth = async (kind, email, password = '') => {
    if (!cloudAuth) return { ok: false, message: 'Cloud sync is not configured yet. You can continue working locally.' }
    try {
      if (kind === 'magic') {
        await cloudAuth.sendMagicLink(email, { emailRedirectTo: window.location.origin })
        return { ok: true, message: 'Check your email for a secure sign-in link.' }
      }
      if (kind === 'sign-up') {
        const { data, error } = await cloudClient.auth.signUp({ email, password })
        if (error) throw error
        if (data.session) setAuthEmail(email)
        return { ok: true, message: data.session ? 'Your account is ready.' : 'Check your email to confirm your account.' }
      }
      await cloudAuth.signInWithPassword(email, password)
      setAuthEmail(email)
      setAuthOpen(false)
      return { ok: true, message: 'You are signed in.' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'The sign-in request could not be completed.' }
    }
  }

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-is-collapsed'}`}>
      <CalendarIntegrationStyle />
      <header className="topbar">
        <div className="topbar__brand">
          <button aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'} className="icon-button topbar__menu" onClick={() => setSidebarOpen((open) => !open)} title="Toggle navigation" type="button">
            <Icon name="menu" size={18} />
          </button>
          <button className="brand-lockup" onClick={() => navigate('today')} type="button">
            <LogoMark />
            <span>Daymark</span>
          </button>
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
          <SyncStatus
            isOnline={isOnline}
            onSync={() => setNotice(isOnline ? 'Local workspace is up to date.' : 'Changes are saved locally and will sync when you are back online.')}
            pendingCount={0}
            syncError={offlineError}
          />
          {installState.available ? <button className="text-button" onClick={() => void installPrompt.prompt()} type="button">Install</button> : null}
          {updateState.available ? <button className="text-button" onClick={() => serviceWorkerUpdate.apply()} type="button">Update</button> : null}
          <span className="topbar__divider" />
          <button className="avatar-button" onClick={() => authEmail ? setAccountOpen(true) : setAuthOpen(true)} title="Open profile menu" type="button">
            {authEmail ? authEmail.slice(0, 2).toUpperCase() : 'ML'}
          </button>
        </div>
      </header>

      <div className="shell-grid">
        <aside className="sidebar" aria-label="Primary navigation">
          <div className="sidebar__scroll">
            <SidebarSection title="WORKSPACE">
              {NAV_ITEMS.map((item) => (
                <SidebarRow
                  active={route === item.id}
                  count={item.id === 'today' ? tasks.filter((task) => state.tasks[task.id]?.due?.date === today && !task.completed).length : item.id === 'inbox' ? tasks.filter((task) => task.project === state.preferences.inboxProjectId && !task.completed).length : tasks.filter((task) => state.tasks[task.id]?.due?.date >= today && !task.completed).length}
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
              {projectItems.map((project) => (
                <SidebarRow
                  active={route === `project:${project.id}`}
                  color={PROJECT_COLORS[project.color] ?? 'teal'}
                  count={tasks.filter((task) => task.project === project.id && !task.completed).length}
                  key={project.id}
                  label={project.name}
                  onClick={() => navigate(`project:${project.id}`)}
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
            <SidebarRow icon="settings" label="Settings" onClick={() => undefined} />
            <span className="sidebar__version">LOCAL SHELL 0.1</span>
          </div>
        </aside>

        <main className="main-content">
          <div className="content-frame">
            <div className="view-header">
              <div>
                <span className="section-kicker">{routeInfo.kicker}</span>
                <h1>{routeInfo.title}</h1>
                <p>{routeInfo.subtitle}</p>
              </div>
              <div className="view-header__actions">
                {route !== 'upcoming' ? (
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
                <button className="primary-button" onClick={() => openTaskEditor('create', null, route === 'upcoming' ? selectedCalendarDate : null)} type="button">
                  <Icon name="plus" size={17} />
                  Add task
                </button>
                {route.startsWith('project:') ? <button className="secondary-button" onClick={() => setCollaborationOpen(true)} type="button">Share</button> : null}
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

            {route === 'upcoming' ? (
              <>
              <IntegratedUpcomingCalendar
                initialMode="month"
                onDateSelect={setSelectedCalendarDate}
                onTaskAdd={(date) => openTaskEditor('create', null, date)}
                onTaskQuickAdd={(date, title) => {
                  const projectId = state.preferences.activeProjectId ?? state.preferences.inboxProjectId
                  const sectionId = Object.values(state.sections).find((section) => section.projectId === projectId)?.id ?? null
                  const result = repository.addTask({ content: title, projectId, sectionId, due: makeDue(date) })
                  if (!result.ok) setNotice(result.message)
                }}
                onTaskEdit={(taskId) => openTaskEditor('edit', state.tasks[taskId])}
                onTaskMove={moveTaskToDate}
                selectedDate={selectedCalendarDate}
                weekStartsOn={1}
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
                <button className="toolbar-button" title="Filter and sort tasks" type="button">
                  <Icon name="filter" size={15} />
                  Sort
                </button>
              </div>

              {viewMode === 'list' ? (
                <div className="task-list">
                  {sections.length ? (
                    sections.map((section) => (
                      <section className="task-section" key={section.name}>
                        <div className="task-section__heading">
                          <span>{section.name}</span>
                          <span>{section.tasks.length}</span>
                          <button aria-label={`Collapse ${section.name}`} className="icon-button" title="Collapse section" type="button">
                            <Icon name="chevronDown" size={16} />
                          </button>
                        </div>
                        {section.tasks.map((task) => (
                          <TaskRow key={task.id} onOpen={(viewTask) => openTaskEditor('edit', state.tasks[viewTask.id])} onToggle={toggleTask} task={task} />
                        ))}
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
                  {(sections.length ? sections : [{ name: 'Focus lane', tasks: [] }]).map((section) => (
                    <section className="board-column" key={section.name}>
                      <div className="board-column__heading">
                        <span>{section.name}</span>
                        <span>{section.tasks.length}</span>
                      </div>
                      <div className="board-column__body">
                        {section.tasks.map((task) => (
                          <button className="board-task" key={task.id} onClick={() => openTaskEditor('edit', state.tasks[task.id])} type="button">
                            <span className={`board-task__priority board-task__priority--${task.priorityTone}`} />
                            <strong>{task.title}</strong>
                            <small>{task.due}</small>
                          </button>
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
          onClose={() => setCommandOpen(false)}
          onCompose={() => openTaskEditor('create')}
          onNavigate={navigate}
          onQueryChange={setCommandQuery}
          query={commandQuery}
        />
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
        onCancel={() => setProjectDialogOpen(false)}
        onCreate={createProject}
      />

      <SearchDialog
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(record) => {
          if (record.type === 'task') openTaskEditor('edit', state.tasks[record.id])
          else if (record.route) navigate(record.route)
        }}
        records={searchRecords}
      />

      <AuthDialog
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onMagicLink={(email) => runAuth('magic', email)}
        onSignIn={({ email, password }) => runAuth('sign-in', email, password)}
        onSignUp={({ email, password }) => runAuth('sign-up', email, password)}
      />

      <AccountDialog
        email={authEmail}
        isOpen={accountOpen}
        onClose={() => setAccountOpen(false)}
        onDeleteAccount={async () => ({ ok: false, message: 'Account deletion requires the deployed account-delete function.' })}
        onSignOut={async () => {
          if (cloudAuth) await cloudAuth.signOut()
          setAuthEmail('')
          setAccountOpen(false)
          return { ok: true, message: 'You are signed out.' }
        }}
        onSignOutAllDevices={async () => ({ ok: false, message: 'Global sign-out requires the deployed account endpoint.' })}
      />

      <CollaborationDialog
        currentUserId="member-local"
        isOpen={collaborationOpen}
        members={collaborationMembers}
        onChangeRole={(memberId, role) => setCollaborationMembers((members) => members.map((member) => member.id === memberId ? { ...member, role } : member))}
        onClose={() => setCollaborationOpen(false)}
        onInvite={({ email, role }) => setCollaborationMembers((members) => [...members, { id: createId('member'), email, role, invitationStatus: 'pending' }])}
        onLeaveProject={() => 'The local workspace owner cannot leave this project.'}
        onRemoveMember={(memberId) => setCollaborationMembers((members) => members.filter((member) => member.id !== memberId))}
        onRevokeInvitation={(memberId) => setCollaborationMembers((members) => members.filter((member) => member.id !== memberId))}
        onTransferOwnership={(memberId) => setCollaborationMembers((members) => members.map((member) => ({ ...member, role: member.id === memberId ? 'owner' : member.id === 'member-local' ? 'admin' : member.role })))}
        projectName={route.startsWith('project:') ? state.projects[route.slice('project:'.length)]?.name ?? 'Project' : 'Project'}
      />

      <ConflictDialog
        isOpen={Boolean(conflictMessage)}
        message={conflictMessage}
        onClose={() => setConflictMessage('')}
        onReload={() => {
          repository.reload()
          setConflictMessage('')
        }}
      />

      <ToastViewport
        onDismiss={(toastId) => setToasts((current) => current.filter((toast) => toast.id !== toastId))}
        toasts={toasts}
      />
    </div>
  )
}

export default function DaymarkApp() {
  return (
    <RepositoryProvider repository={repository}>
      <DaymarkShell />
    </RepositoryProvider>
  )
}
