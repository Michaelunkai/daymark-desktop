import { useEffect, useMemo, useState } from 'react'
import './reminder-planner.css'

const DEFAULT_OFFSETS = [
  { id: 'default-30', minutes: 30, direction: 'before', sound: 'soft' },
  { id: 'default-20', minutes: 20, direction: 'before', sound: 'alert' },
  { id: 'default-10', minutes: 10, direction: 'before', sound: 'alarm' },
]

function newDraft() {
  const start = new Date(Date.now() + 60 * 60 * 1000)
  return {
    id: null,
    title: '',
    details: '',
    eventAt: toLocalDateTime(start),
    offsets: DEFAULT_OFFSETS.map((offset) => ({ ...offset })),
    target: { kind: 'diary', projectId: '', sectionId: '', orderLane: '' },
  }
}

function toLocalDateTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function fromReminder(reminder) {
  return {
    id: reminder.id,
    title: reminder.title,
    details: reminder.details,
    eventAt: toLocalDateTime(reminder.eventAt),
    offsets: reminder.offsets.map((offset) => ({ ...offset })),
    target: {
      kind: reminder.target.kind,
      projectId: reminder.target.projectId ?? '',
      sectionId: reminder.target.sectionId ?? '',
      orderLane: reminder.target.orderLane ?? '',
    },
  }
}

function describeOffset(offset) {
  return `${offset.minutes} min ${offset.direction}`
}

function describeTarget(reminder, projects, sections) {
  if (reminder.target.kind === 'project') {
    const project = projects.find((candidate) => candidate.id === reminder.target.projectId)
    const section = sections.find((candidate) => candidate.id === reminder.target.sectionId)
    return [project?.name, section?.name].filter(Boolean).join(' / ') || 'Project'
  }
  if (reminder.target.kind === 'order') {
    return `Order / ${reminder.target.orderLane === 'now' ? 'Do now' : reminder.target.orderLane === 'after' ? 'After' : 'Later'}`
  }
  return 'Diary'
}

export function ReminderPlanner({
  reminders,
  projects,
  sections,
  notificationStatus,
  onDelete,
  onRequestNotificationAccess,
  onSave,
}) {
  const [editor, setEditor] = useState(null)
  const [error, setError] = useState('')
  const sortedReminders = useMemo(
    () => [...reminders].sort((left, right) => left.eventAt.localeCompare(right.eventAt)),
    [reminders],
  )
  const availableSections = editor
    ? sections.filter((section) => section.projectId === editor.target.projectId)
    : []

  useEffect(() => {
    if (!editor) setError('')
  }, [editor])

  const changeOffset = (id, patch) => {
    setEditor((current) => current ? {
      ...current,
      offsets: current.offsets.map((offset) => offset.id === id ? { ...offset, ...patch } : offset),
    } : current)
  }

  const save = (event) => {
    event.preventDefault()
    if (!editor?.title.trim()) {
      setError('Add a reminder title.')
      return
    }
    if (!editor.eventAt || Number.isNaN(new Date(editor.eventAt).getTime())) {
      setError('Choose a date and time.')
      return
    }
    if (!editor.offsets.length) {
      setError('Add at least one alert.')
      return
    }
    if (editor.target.kind === 'project' && !editor.target.projectId) {
      setError('Choose a project or switch the reminder to Diary.')
      return
    }
    if (editor.target.kind === 'order' && !editor.target.orderLane) {
      setError('Choose an Order section.')
      return
    }
    onSave({
      id: editor.id ?? undefined,
      title: editor.title,
      details: editor.details,
      eventAt: new Date(editor.eventAt).toISOString(),
      offsets: editor.offsets.map((offset, index) => ({
        ...offset,
        id: offset.id || `offset-${index}`,
        minutes: Number(offset.minutes),
      })),
      target: {
        kind: editor.target.kind,
        projectId: editor.target.kind === 'project' ? editor.target.projectId : null,
        sectionId: editor.target.kind === 'project' ? editor.target.sectionId || null : null,
        orderLane: editor.target.kind === 'order' ? editor.target.orderLane : null,
      },
    })
    setEditor(null)
  }

  return (
    <section className="reminder-planner" aria-label="Reminders">
      <div className="reminder-planner__toolbar">
        <div>
          <h2>Reminders</h2>
          <p>{notificationStatus === 'ready' ? 'Notifications are ready.' : notificationStatus === 'exact-alarm-required' ? 'Allow precise alarms for exact alert timing.' : notificationStatus === 'browser' ? 'Alerts are scheduled when you use Daymark on Android.' : 'Allow notifications to hear every alert.'}</p>
        </div>
        <div className="reminder-planner__toolbar-actions">
          {notificationStatus !== 'ready' && notificationStatus !== 'browser' ? <button className="secondary-button" onClick={onRequestNotificationAccess} type="button">{notificationStatus === 'exact-alarm-required' ? 'Allow precise alarms' : 'Allow alerts'}</button> : null}
          <button className="reminder-planner__create" onClick={() => setEditor(newDraft())} type="button">New reminder</button>
        </div>
      </div>

      {editor ? (
        <form className="reminder-planner__editor" onSubmit={save}>
          <div className="reminder-planner__editor-heading">
            <strong>{editor.id ? 'Edit reminder' : 'New reminder'}</strong>
            <button className="text-button" onClick={() => setEditor(null)} type="button">Close</button>
          </div>
          <label>
            <span>What should Daymark remind you about?</span>
            <input autoFocus onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Call the dentist" value={editor.title} />
          </label>
          <label>
            <span>Details</span>
            <textarea onChange={(event) => setEditor((current) => ({ ...current, details: event.target.value }))} placeholder="Optional context for the notification" rows={3} value={editor.details} />
          </label>
          <label>
            <span>Date and time</span>
            <input onChange={(event) => setEditor((current) => ({ ...current, eventAt: event.target.value }))} type="datetime-local" value={editor.eventAt} />
          </label>

          <div className="reminder-planner__destination">
            <span>Where it belongs</span>
            <div aria-label="Reminder destination" className="reminder-planner__target-tabs" role="group">
              {[
                ['diary', 'Diary'],
                ['project', 'Project'],
                ['order', 'Order'],
              ].map(([kind, label]) => (
                <button
                  aria-pressed={editor.target.kind === kind}
                  key={kind}
                  onClick={() => setEditor((current) => ({
                    ...current,
                    target: { kind, projectId: '', sectionId: '', orderLane: '' },
                  }))}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {editor.target.kind === 'project' ? (
              <div className="reminder-planner__target-fields">
                <select aria-label="Reminder project" onChange={(event) => setEditor((current) => ({
                  ...current,
                  target: { ...current.target, projectId: event.target.value, sectionId: '' },
                }))} value={editor.target.projectId}>
                  <option value="">Choose project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <select aria-label="Reminder section" disabled={!editor.target.projectId} onChange={(event) => setEditor((current) => ({
                  ...current,
                  target: { ...current.target, sectionId: event.target.value },
                }))} value={editor.target.sectionId}>
                  <option value="">No section</option>
                  {availableSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                </select>
              </div>
            ) : null}
            {editor.target.kind === 'order' ? (
              <select aria-label="Reminder Order section" onChange={(event) => setEditor((current) => ({
                ...current,
                target: { ...current.target, orderLane: event.target.value },
              }))} value={editor.target.orderLane}>
                <option value="">Choose Order section</option>
                <option value="now">Do now</option>
                <option value="later">Later</option>
                <option value="after">After</option>
              </select>
            ) : null}
          </div>

          <section className="reminder-planner__alerts">
            <div>
              <strong>Alerts</strong>
              <span>New reminders start with 30, 20, and 10 minutes before.</span>
            </div>
            {editor.offsets.map((offset) => (
              <div className="reminder-planner__alert-row" key={offset.id}>
                <input aria-label="Alert minutes" min="0" onChange={(event) => changeOffset(offset.id, { minutes: event.target.value })} type="number" value={offset.minutes} />
                <select aria-label="Before or after" onChange={(event) => changeOffset(offset.id, { direction: event.target.value })} value={offset.direction}>
                  <option value="before">Before</option>
                  <option value="after">After</option>
                </select>
                <select aria-label="Alert sound" onChange={(event) => changeOffset(offset.id, { sound: event.target.value })} value={offset.sound}>
                  <option value="soft">Soft sound</option>
                  <option value="alert">Alert sound</option>
                  <option value="alarm">Alarm sound</option>
                </select>
                <button aria-label={`Remove ${describeOffset(offset)} alert`} className="reminder-planner__remove-alert" onClick={() => setEditor((current) => ({
                  ...current,
                  offsets: current.offsets.filter((candidate) => candidate.id !== offset.id),
                }))} type="button">Remove</button>
              </div>
            ))}
            <button className="secondary-button" onClick={() => setEditor((current) => ({
              ...current,
              offsets: [...current.offsets, {
                id: `offset-${Date.now()}`,
                minutes: 5,
                direction: 'before',
                sound: 'soft',
              }],
            }))} type="button">Add alert</button>
          </section>
          {error ? <p className="reminder-planner__error" role="alert">{error}</p> : null}
          <div className="reminder-planner__editor-actions">
            <button className="secondary-button" onClick={() => setEditor(null)} type="button">Cancel</button>
            <button className="reminder-planner__create" type="submit">{editor.id ? 'Save changes' : 'Save reminder'}</button>
          </div>
        </form>
      ) : null}

      <div className="reminder-planner__list">
        {sortedReminders.length ? sortedReminders.map((reminder) => (
          <article className="reminder-planner__item" key={reminder.id}>
            <button className="reminder-planner__item-main" onClick={() => setEditor(fromReminder(reminder))} type="button">
              <strong>{reminder.title}</strong>
              <span>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(reminder.eventAt))}</span>
              <small>{describeTarget(reminder, projects, sections)} | {reminder.offsets.map(describeOffset).join(', ')}</small>
            </button>
            <button aria-label={`Delete reminder ${reminder.title}`} className="danger-button" onClick={() => onDelete(reminder.id)} type="button">Delete</button>
          </article>
        )) : (
          <div className="reminder-planner__empty">
            <h3>No reminders yet</h3>
            <p>Create one for a date and time, then choose every alert you want before or after it.</p>
          </div>
        )}
      </div>
    </section>
  )
}
