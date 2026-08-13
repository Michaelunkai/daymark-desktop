import { useEffect, useMemo, useRef, useState } from 'react'

import { toLocalDate } from '../../core/dates'
import { DatePicker } from '../calendar/DatePicker'
import { createLongPressReorderController } from '../reorder/long-press.js'
import { getTaskTransferDestinationError } from '../task-editor/form-state'
import './order.css'

const LANES = [
  { id: 'now', label: 'Do now', hint: 'The next actions worth attention.' },
  { id: 'later', label: 'Later', hint: 'Useful, but not for this moment.' },
  { id: 'after', label: 'After', hint: 'Continue after a related item is finished.' },
]

const PRIORITIES = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Low' },
  { value: 4, label: 'Normal' },
]

function OrderItemCard({
  dragging,
  index,
  item,
  laneItems,
  onComplete,
  onEdit,
  onMove,
  onSetDragging,
  onUpdate,
  orderedItems,
}) {
  const lastTargetRef = useRef(null)
  const callbacksRef = useRef({ itemId: item.id, onMove, onSetDragging, onUpdate })
  callbacksRef.current = { itemId: item.id, onMove, onSetDragging, onUpdate }
  const controllerRef = useRef(null)

  if (!controllerRef.current) {
    controllerRef.current = createLongPressReorderController({
      onLongPress: () => {
        lastTargetRef.current = null
        callbacksRef.current.onSetDragging?.(callbacksRef.current.itemId)
      },
      onDragMove: (event) => {
        const target = document.elementFromPoint(event.clientX, event.clientY)
        const targetId = target?.closest('[data-order-reorder-id]')?.getAttribute('data-order-reorder-id')
        const laneId = target?.closest('[data-order-lane]')?.getAttribute('data-order-lane')
        if (targetId && targetId !== callbacksRef.current.itemId && targetId !== lastTargetRef.current) {
          lastTargetRef.current = targetId
          callbacksRef.current.onMove?.(callbacksRef.current.itemId, targetId, laneId)
        } else if (!targetId && laneId && laneId !== lastTargetRef.current) {
          lastTargetRef.current = laneId
          callbacksRef.current.onUpdate?.(callbacksRef.current.itemId, { lane: laneId, relationId: null })
        }
      },
      onDragEnd: () => {
        lastTargetRef.current = null
        callbacksRef.current.onSetDragging?.(null)
      },
    })
  }

  useEffect(() => () => controllerRef.current?.dispose(), [])

  return (
    <article
      className={`order-item ${dragging ? 'is-dragging' : ''}`}
      data-order-reorder-id={item.id}
      draggable
      onContextMenu={(event) => event.preventDefault()}
      onDragEnd={() => onSetDragging(null)}
      onDragStart={() => onSetDragging(item.id)}
    >
      <button
        aria-label={`Complete ${item.title}`}
        className={`order-item__complete ${item.status === 'done' ? 'is-completed' : ''}`}
        onClick={() => onComplete(item)}
        title="Complete and move to Completed"
        type="button"
      >
        ✓
      </button>
      <button
        aria-label={`Drag ${item.title}`}
        className="order-item__grip"
        onLostPointerCapture={(event) => controllerRef.current.pointerCancel(event)}
        onPointerCancel={(event) => controllerRef.current.pointerCancel(event)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          controllerRef.current.pointerDown(event)
        }}
        onPointerMove={(event) => controllerRef.current.pointerMove(event)}
        onPointerUp={(event) => controllerRef.current.pointerUp(event)}
        title="Long press and move to reorder"
        type="button"
      >
        ::
      </button>
      <div className="order-item__body">
        <div className="order-item__title-row">
          <button className="order-item__title" onClick={() => onEdit(item)} type="button">{item.title}</button>
          <span className={`order-priority order-priority--${item.priority}`}>{PRIORITIES.find((priority) => priority.value === item.priority)?.label}</span>
        </div>
        <p className="order-item__details">
          {item.details || 'No details yet. Open this item to add context.'}
        </p>
        <div className="order-item__meta">
          <span className={`order-status order-status--${item.status}`}>{item.status}</span>
          {item.relationId ? <span>after {orderedItems.find((candidate) => candidate.id === item.relationId)?.title ?? 'another item'}</span> : null}
        </div>
      </div>
      <div className="order-item__actions">
        <div className="order-item__reorder-actions">
          <button aria-label={`Move ${item.title} earlier`} disabled={index === 0} onClick={() => onMoveBy(item, -1, laneItems, onMove)} title="Move earlier" type="button">Move up</button>
          <button aria-label={`Move ${item.title} later`} disabled={index === laneItems.length - 1} onClick={() => onMoveBy(item, 1, laneItems, onMove)} title="Move later" type="button">Move down</button>
        </div>
        <div aria-label={`Move ${item.title} to another section`} className="order-item__lanes">
          {LANES.map((lane) => (
            <button
              aria-label={`Move ${item.title} to ${lane.label}`}
              className={item.lane === lane.id ? 'is-active' : ''}
              disabled={item.lane === lane.id}
              key={lane.id}
              onClick={() => onUpdate(item.id, { lane: lane.id, relationId: null })}
              title={`Move to ${lane.label}`}
              type="button"
            >
              {lane.label.replace(' ', '\n')}
            </button>
          ))}
        </div>
        <div className="order-item__edit-actions">
          <button aria-label={`Edit ${item.title}`} onClick={() => onEdit(item)} title="Edit item" type="button">Edit</button>
          <button aria-label={`Complete ${item.title}`} className="order-item__complete-action" onClick={() => onComplete(item)} title="Complete and move to Completed" type="button">Done</button>
        </div>
      </div>
    </article>
  )
}

function onMoveBy(item, direction, siblings, onMove) {
  const index = siblings.findIndex((candidate) => candidate.id === item.id)
  const next = siblings[index + direction]
  if (next) onMove(item.id, next.id, item.lane)
}

function OrderLane({
  draggingId,
  lane,
  onAdd,
  onComplete,
  onDrop,
  onEdit,
  onMove,
  onSetDragging,
  onUpdate,
  orderedItems,
}) {
  return (
    <section
      className={`order-lane order-lane--${lane.id}`}
      data-order-lane={lane.id}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onDrop(lane.id)}
    >
      <div className="order-lane__header">
        <div>
          <h2>{lane.label}</h2>
          <p>{lane.hint}</p>
        </div>
        <span aria-label={`${lane.items.length} items`} className="order-lane__count">{lane.items.length}</span>
      </div>
      <div className="order-lane__items">
        {lane.items.length ? lane.items.map((item, index) => (
          <OrderItemCard
            dragging={draggingId === item.id}
            index={index}
            item={item}
            key={item.id}
            laneItems={lane.items}
            onComplete={onComplete}
            onEdit={onEdit}
            onMove={onMove}
            onSetDragging={onSetDragging}
            onUpdate={onUpdate}
            orderedItems={orderedItems}
          />
        )) : <p className="order-lane__empty">Drop an item here or add one below.</p>}
      </div>
      <button className="order-lane__add" onClick={() => onAdd(lane.id)} type="button"><span aria-hidden="true">+</span> Add to {lane.label.toLowerCase()}</button>
    </section>
  )
}

export function OrderWorkspace({
  items,
  onAdd,
  onUpdate,
  onComplete,
  onMove,
  projects = [],
  sections = [],
  onMoveToTask,
  onCopyToTask,
}) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)
  const [transferError, setTransferError] = useState('')
  const [dateTransferAction, setDateTransferAction] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const dateTransferRef = useRef(null)
  const today = useMemo(() => toLocalDate(new Date()), [])
  const orderedItems = useMemo(
    () => [...items]
      .map((item) => item.lane === 'before' ? { ...item, lane: 'after' } : item)
      .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt)),
    [items],
  )
  const relationOptions = orderedItems.filter((item) => item.id !== draft?.id)
  const taskSectionOptions = sections.filter((section) => section.projectId === draft?.taskProjectId)

  useEffect(() => {
    if (!dateTransferAction) return undefined
    const frame = window.requestAnimationFrame(() => {
      dateTransferRef.current?.querySelector('.date-picker__day[tabindex="0"]')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [dateTransferAction])

  const openCreate = (lane = 'now') => {
    setEditing('create')
    setDraft({ title: '', details: '', lane, relationId: null, priority: 4, status: 'open' })
    setTransferError('')
    setDateTransferAction(null)
  }

  const openEdit = (item) => {
    setEditing(item.id)
    setDraft({ ...item, taskProjectId: '', taskSectionId: '', taskDueText: '' })
    setTransferError('')
    setDateTransferAction(null)
  }

  const closeEditor = () => {
    setEditing(null)
    setDraft(null)
    setTransferError('')
    setDateTransferAction(null)
  }

  const save = (event) => {
    event.preventDefault()
    if (!draft?.title.trim()) return
    if (editing === 'create') onAdd(draft)
    else {
      const { taskProjectId, taskSectionId, taskDueText, ...orderDraft } = draft
      onUpdate(editing, orderDraft)
    }
    closeEditor()
  }

  const transferToTask = (callback) => {
    if (!editing || editing === 'create' || !callback) return
    const destinationError = getTaskTransferDestinationError({
      projectId: draft.taskProjectId,
      sectionId: draft.taskSectionId,
    })
    if (destinationError) {
      setTransferError(destinationError)
      return
    }
    if (callback(editing, draft)) closeEditor()
  }

  const transferOrderItemToDate = (date) => {
    if (!date || !dateTransferAction || !editing || editing === 'create') return
    const callback = dateTransferAction === 'move' ? onMoveToTask : onCopyToTask
    if (!callback) return
    const scheduledTaskDraft = {
      ...draft,
      taskProjectId: null,
      taskSectionId: null,
      taskDueText: date,
    }
    if (callback(editing, scheduledTaskDraft)) closeEditor()
  }

  const moveBy = (item, direction) => {
    const siblings = orderedItems.filter((candidate) => candidate.lane === item.lane)
    const index = siblings.findIndex((candidate) => candidate.id === item.id)
    const next = siblings[index + direction]
    if (!next) return
    onMove(item.id, next.id)
  }

  const grouped = LANES.map((lane) => ({
    ...lane,
    items: orderedItems.filter((item) => item.lane === lane.id),
  }))
  const scrollToLane = (laneId) => {
    document.querySelector(`[data-order-lane="${laneId}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }
  const dropIntoLane = (laneId) => {
    if (draggingId) onUpdate(draggingId, { lane: laneId, relationId: null })
    setDraggingId(null)
  }

  return (
    <section aria-labelledby="order-title" className="order-workspace">
      <header className="order-header">
        <div>
          <span className="section-kicker">WORKSPACE ORDER</span>
          <h1 id="order-title">Order</h1>
          <p>Turn loose thoughts into a sequence you can actually follow.</p>
        </div>
        <button className="primary-button" onClick={() => openCreate('now')} type="button">
          <span aria-hidden="true">+</span>
          Add item
        </button>
      </header>

      <div className="order-intro">
        <strong>{orderedItems.length ? `${orderedItems.length} sequenced items` : 'A clear place to decide what comes next'}</strong>
        <span>Changes sync with your paired devices and stay with the rest of your workspace.</span>
      </div>

      {orderedItems.length ? (
        <>
        <nav aria-label="Order sections" className="order-lane-nav">
          {grouped.map((lane) => (
            <button
              className={`order-lane-nav__item order-lane-nav__item--${lane.id}`}
              key={lane.id}
              onClick={() => scrollToLane(lane.id)}
              type="button"
            >
              <span aria-hidden="true" className="order-lane-nav__marker" />
              <span className="order-lane-nav__copy">
                <strong>{lane.label}</strong>
                <small>{lane.hint}</small>
              </span>
              <span aria-label={`${lane.items.length} items`} className="order-lane-nav__count">{lane.items.length}</span>
            </button>
          ))}
        </nav>
        <div className="order-lanes">
          {grouped.map((lane) => (
            <OrderLane
              draggingId={draggingId}
              key={lane.id}
              lane={lane}
              onAdd={openCreate}
              onComplete={onComplete}
              onDrop={dropIntoLane}
              onEdit={openEdit}
              onMove={onMove}
              onSetDragging={setDraggingId}
              onUpdate={onUpdate}
              orderedItems={orderedItems}
            />
          ))}
        </div>
        </>
      ) : (
        <div className="order-empty">
          <span aria-hidden="true" className="order-empty__mark">1</span>
          <h2>Nothing is ordered yet</h2>
          <p>Start with the next action, then place everything else around it.</p>
          <button className="secondary-button" onClick={openCreate} type="button">Create the first item</button>
        </div>
      )}

      {editing ? (
        <div className="order-editor-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeEditor()}>
          <form
            aria-labelledby="order-editor-title"
            className={`order-editor${dateTransferAction ? ' order-editor--date-transfer' : ''}`}
            onSubmit={save}
          >
            <div className="order-editor__header">
              <div>
                <span className="section-kicker">ORDER ITEM</span>
                <h2 id="order-editor-title">
                  {dateTransferAction === 'move'
                    ? 'Move item to a calendar date'
                    : dateTransferAction === 'copy'
                      ? 'Copy item to a calendar date'
                      : editing === 'create'
                        ? 'Add to the sequence'
                        : 'Edit sequence item'}
                </h2>
              </div>
              <button aria-label="Close Order editor" className="icon-button" onClick={closeEditor} title="Close" type="button">x</button>
            </div>
            {dateTransferAction ? (
              <section className="order-editor__calendar-transfer" ref={dateTransferRef}>
                <div className="order-editor__calendar-transfer-intro">
                  <span className="section-kicker">CALENDAR DESTINATION</span>
                  <strong>
                    {dateTransferAction === 'move'
                      ? 'Choose the day for this item'
                      : 'Choose the day for the copy'}
                  </strong>
                  <span>Clicking a date completes the action immediately in Inbox.</span>
                </div>
                <DatePicker
                  allowClear={false}
                  label={dateTransferAction === 'move' ? 'Move Order item to date' : 'Copy Order item to date'}
                  onChange={transferOrderItemToDate}
                  onDismiss={() => setDateTransferAction(null)}
                  showTextEntry={false}
                  today={today}
                />
              </section>
            ) : null}
            <label>Title<input autoFocus onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
            <label>Details<textarea onChange={(event) => setDraft({ ...draft, details: event.target.value })} rows={6} value={draft.details} /></label>
            <div className="order-editor__grid">
              <label>Group<select onChange={(event) => setDraft({ ...draft, lane: event.target.value, relationId: event.target.value === 'now' || event.target.value === 'later' ? null : draft.relationId })} value={draft.lane}>{LANES.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}</select></label>
              <label>Priority<select onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })} value={draft.priority}>{PRIORITIES.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}</select></label>
              <label>Status<select onChange={(event) => setDraft({ ...draft, status: event.target.value })} value={draft.status === 'done' ? 'open' : draft.status}><option value="open">Open</option><option value="blocked">Blocked</option></select></label>
            </div>
            {draft.lane === 'after' ? (
              <label>After item<select onChange={(event) => setDraft({ ...draft, relationId: event.target.value || null })} value={draft.relationId ?? ''}><option value="">Choose a related item</option>{relationOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            ) : null}
            {editing !== 'create' && (onMoveToTask || onCopyToTask) ? (
              <section className="order-editor__transfer">
                <div>
                  <span className="section-kicker">TASK DESTINATION</span>
                  <strong>Choose where this task belongs</strong>
                </div>
                <div className="order-editor__transfer-grid">
                  <label>Project<select onChange={(event) => {
                    const value = event.target.value
                    setTransferError('')
                    setDraft({
                      ...draft,
                      taskProjectId: value === '__inbox__' ? null : value,
                      taskSectionId: '',
                    })
                  }} value={draft.taskProjectId === null ? '__inbox__' : draft.taskProjectId ?? ''}>
                    <option value="">Choose a project</option>
                    <option value="__inbox__">Inbox</option>
                    {projects.map((project) => <option disabled={project.disabled} key={project.id} value={project.id}>{project.label}</option>)}
                  </select></label>
                  <label>Section<select disabled={draft.taskProjectId === ''} onChange={(event) => {
                    setTransferError('')
                    setDraft({
                      ...draft,
                      taskSectionId: event.target.value === '__none__' ? null : event.target.value,
                    })
                  }} value={draft.taskSectionId === null ? '__none__' : draft.taskSectionId ?? ''}>
                    <option value="">{draft.taskProjectId === '' ? 'Choose a project first' : 'Choose a section'}</option>
                    <option value="__none__">No section</option>
                    {taskSectionOptions.map((section) => <option disabled={section.disabled} key={section.id} value={section.id}>{section.label}</option>)}
                  </select></label>
                  <label className="order-editor__transfer-date">
                    Schedule destination
                    <span className="order-editor__date-shortcuts">
                      <button onClick={() => setDraft({ ...draft, taskDueText: 'today' })} type="button">Today</button>
                      <button onClick={() => setDraft({ ...draft, taskDueText: 'tomorrow' })} type="button">Tomorrow</button>
                      <button onClick={() => setDraft({ ...draft, taskDueText: '' })} type="button">No date</button>
                    </span>
                    <input
                      onChange={(event) => setDraft({ ...draft, taskDueText: event.target.value })}
                      placeholder="e.g. today or 2026-12-31"
                      value={draft.taskDueText ?? ''}
                    />
                  </label>
                </div>
                {transferError ? <p className="order-editor__transfer-error" role="alert">{transferError}</p> : null}
              </section>
            ) : null}
            <footer className="order-editor__footer">
              {editing !== 'create' && (onMoveToTask || onCopyToTask) ? (
                <div className="order-editor__transfer-actions">
                  {onMoveToTask ? <button className="secondary-button" onClick={() => setDateTransferAction('move')} type="button">Move to date</button> : null}
                  {onCopyToTask ? <button className="secondary-button" onClick={() => setDateTransferAction('copy')} type="button">Copy to date</button> : null}
                  {onMoveToTask ? <button className="secondary-button" onClick={() => transferToTask(onMoveToTask)} type="button">Move to task</button> : null}
                  {onCopyToTask ? <button className="secondary-button" onClick={() => transferToTask(onCopyToTask)} type="button">Copy to task</button> : null}
                </div>
              ) : null}
              <div className="order-editor__actions">
                <button className="secondary-button" onClick={closeEditor} type="button">Cancel</button>
                <button className="primary-button" type="submit">Save item</button>
              </div>
            </footer>
            {dateTransferAction ? (
              <footer className="order-editor__date-transfer-footer">
                <span>Select a date above to complete the action.</span>
                <button className="secondary-button" onClick={() => setDateTransferAction(null)} type="button">
                  Cancel transfer
                </button>
              </footer>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  )
}
