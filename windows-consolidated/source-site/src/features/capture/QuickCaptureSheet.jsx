import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyClipboardToDraft,
  buildQuickOrderInput,
  buildQuickTaskInput,
  createQuickSearchEntries,
  createQuickOrderDraftFromTask,
  createQuickTaskDraftFromOrder,
  findQuickMatches,
  getQuickSaveAction,
  QUICK_ORDER_LANES,
  resolveSectionForProject,
} from './quick-capture-model'
import './quick-capture.css'

function emptyTask(inboxProjectId) {
  return { title: '', details: '', projectId: inboxProjectId, sectionId: '', date: '', time: '', priority: 4 }
}

function emptyOrder() {
  return { title: '', details: '', lane: 'now', relationId: '', priority: 4 }
}

export function QuickCaptureSheet({
  inboxProjectId,
  isOpen,
  onClose,
  onConvertOrderToTask,
  onConvertTaskToOrder,
  onSaveOrder,
  onSaveTask,
  orderItems = [],
  projects = [],
  sections = [],
  tasks = [],
}) {
  const [kind, setKind] = useState('task')
  const [editingId, setEditingId] = useState('')
  const [sourceDestination, setSourceDestination] = useState(null)
  const [conversion, setConversion] = useState(null)
  const [task, setTask] = useState(() => emptyTask(inboxProjectId))
  const [order, setOrder] = useState(emptyOrder)
  const [finderQuery, setFinderQuery] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [error, setError] = useState('')
  const sheetRef = useRef(null)
  const finderRef = useRef(null)
  const titleRef = useRef(null)
  const returnFocusRef = useRef(null)
  const sectionsByProjectRef = useRef(new Map())
  const matchingSections = useMemo(() => sections.filter((section) => section.projectId === task.projectId), [sections, task.projectId])
  const searchEntries = useMemo(
    () => createQuickSearchEntries({ orderItems, projects, sections, tasks }),
    [orderItems, projects, sections, tasks],
  )
  const finderResults = useMemo(() => findQuickMatches(searchEntries, finderQuery), [finderQuery, searchEntries])
  const projectName = projects.find((project) => project.id === task.projectId)?.name ?? 'Choose project'
  const sectionName = matchingSections.find((section) => section.id === task.sectionId)?.name ?? 'No section'
  const relatedOrderTitle = orderItems.find((item) => item.id === order.relationId)?.title ?? 'Choose an item'

  useEffect(() => {
    if (!isOpen) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setKind('task')
    setEditingId('')
    setSourceDestination(null)
    setConversion(null)
    setTask(emptyTask(inboxProjectId))
    setOrder(emptyOrder())
    setFinderQuery('')
    setDetailsOpen(false)
    setError('')
    const focusFrame = requestAnimationFrame(() => {
      finderRef.current?.focus()
    })
    return () => {
      cancelAnimationFrame(focusFrame)
      returnFocusRef.current?.focus?.()
    }
  }, [inboxProjectId, isOpen])

  if (!isOpen) return null

  const selectKind = (nextKind) => {
    setKind(nextKind)
    setEditingId('')
    setSourceDestination(null)
    setConversion(null)
    setError('')
    setDetailsOpen(false)
    if (nextKind === 'task') {
      setTask(emptyTask(inboxProjectId))
    } else {
      setOrder(emptyOrder())
    }
  }

  const chooseTask = (id) => {
    setKind('task')
    setEditingId(id)
    setConversion(null)
    const source = tasks.find((candidate) => candidate.id === id)
    if (!source) {
      setTask(emptyTask(inboxProjectId))
      setSourceDestination(null)
      return
    }
    const sourceTask = {
      title: source.content,
      details: source.description ?? '',
      projectId: source.projectId,
      sectionId: source.sectionId ?? '',
      date: source.due?.date ?? '',
      time: source.due?.time ?? '',
      priority: source.priority ?? 4,
    }
    sectionsByProjectRef.current.set(sourceTask.projectId, sourceTask.sectionId)
    setTask(sourceTask)
    setSourceDestination({ kind: 'task', projectId: sourceTask.projectId, sectionId: sourceTask.sectionId, date: sourceTask.date, time: sourceTask.time })
    setDetailsOpen(Boolean(sourceTask.details))
    setFinderQuery('')
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const chooseOrder = (id) => {
    setKind('order')
    setEditingId(id)
    setConversion(null)
    const source = orderItems.find((candidate) => candidate.id === id)
    if (!source) {
      setOrder(emptyOrder())
      setSourceDestination(null)
      return
    }
    const sourceOrder = { title: source.title, details: source.details ?? '', lane: source.lane, relationId: source.relationId ?? '', priority: source.priority ?? 4 }
    setOrder(sourceOrder)
    setSourceDestination({ kind: 'order', lane: sourceOrder.lane, relationId: sourceOrder.relationId })
    setDetailsOpen(Boolean(sourceOrder.details))
    setFinderQuery('')
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const chooseEntry = (entry) => {
    if (entry.kind === 'task') chooseTask(entry.id)
    else chooseOrder(entry.id)
  }

  const startNewFromFinder = (nextKind) => {
    const title = finderQuery.trim()
    selectKind(nextKind)
    if (nextKind === 'task') setTask({ ...emptyTask(inboxProjectId), title })
    else setOrder({ ...emptyOrder(), title })
    setFinderQuery('')
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const changeTaskProject = (projectId) => {
    setTask((current) => {
      sectionsByProjectRef.current.set(current.projectId, current.sectionId)
      return {
        ...current,
        projectId,
        sectionId: resolveSectionForProject(projectId, sectionsByProjectRef.current.get(projectId), sections),
      }
    })
  }

  const changeTaskSection = (sectionId) => {
    sectionsByProjectRef.current.set(task.projectId, sectionId)
    setTask({ ...task, sectionId })
  }

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard?.readText?.()
      if (!text?.trim()) {
        setError('Clipboard is empty or unavailable.')
        return
      }
      if (kind === 'task') {
        setTask((current) => applyClipboardToDraft(current, text))
      } else {
        setOrder((current) => applyClipboardToDraft(current, text))
      }
      setDetailsOpen(true)
      setError('')
      requestAnimationFrame(() => titleRef.current?.focus())
    } catch {
      setError('Daymark could not read the clipboard.')
    }
  }

  const startTaskToOrderConversion = () => {
    if (!editingId || kind !== 'task' || typeof onConvertTaskToOrder !== 'function') return
    setConversion({ from: 'task', sourceId: editingId, sourceDestination, sourceDraft: task })
    setKind('order')
    setOrder(createQuickOrderDraftFromTask(task))
    setSourceDestination(null)
    setDetailsOpen(Boolean(task.details))
    setError('')
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const startOrderToTaskConversion = () => {
    if (!editingId || kind !== 'order' || typeof onConvertOrderToTask !== 'function') return
    setConversion({ from: 'order', sourceId: editingId, sourceDestination, sourceDraft: order })
    setKind('task')
    setTask(createQuickTaskDraftFromOrder(order, inboxProjectId))
    setSourceDestination(null)
    setDetailsOpen(Boolean(order.details))
    setError('')
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const cancelConversion = () => {
    if (!conversion) return
    setKind(conversion.from)
    setSourceDestination(conversion.sourceDestination)
    if (conversion.from === 'task') {
      setTask(conversion.sourceDraft)
      setDetailsOpen(Boolean(conversion.sourceDraft.details))
    } else {
      setOrder(conversion.sourceDraft)
      setDetailsOpen(Boolean(conversion.sourceDraft.details))
    }
    setConversion(null)
    setError('')
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const save = (event) => {
    event.preventDefault()
    const saveAction = getQuickSaveAction(kind, conversion)
    let result
    if (saveAction === 'convert-task-to-order') {
      result = !order.title.trim()
        ? { ok: false, message: 'Add an Order item name.' }
        : onConvertTaskToOrder?.(conversion.sourceId, buildQuickOrderInput(order))
    } else if (saveAction === 'convert-order-to-task') {
      result = !task.title.trim()
        ? { ok: false, message: 'Add a task name.' }
        : onConvertOrderToTask?.(conversion.sourceId, buildQuickTaskInput(task))
    } else if (saveAction === 'save-task') {
      result = !task.title.trim()
        ? { ok: false, message: 'Add a task name.' }
        : onSaveTask(editingId || null, buildQuickTaskInput(task))
    } else {
      result = !order.title.trim()
        ? { ok: false, message: 'Add an Order item name.' }
        : onSaveOrder(editingId || null, buildQuickOrderInput(order))
    }
    if (!result?.ok) {
      setError(result?.message ?? 'Daymark could not save that item.')
      return
    }
    onClose()
  }

  const isTask = kind === 'task'
  const canConvert = !conversion && editingId && (
    isTask ? typeof onConvertTaskToOrder === 'function' : typeof onConvertOrderToTask === 'function'
  )
  const isMove = isTask
    ? sourceDestination?.kind === 'task' && (
      sourceDestination.projectId !== task.projectId ||
      sourceDestination.sectionId !== task.sectionId ||
      sourceDestination.date !== task.date ||
      sourceDestination.time !== task.time
    )
    : sourceDestination?.kind === 'order' && (
      sourceDestination.lane !== order.lane ||
      sourceDestination.relationId !== order.relationId
    )
  const destinationSummary = isTask
    ? [projectName, sectionName, task.date ? `${task.date}${task.time ? ` at ${task.time}` : ''}` : 'No date'].join(' - ')
    : ['Order', QUICK_ORDER_LANES.find(([value]) => value === order.lane)?.[1] ?? order.lane, order.lane === 'after' ? relatedOrderTitle : ''].filter(Boolean).join(' - ')
  const submitLabel = editingId
    ? (conversion
      ? `Convert ${conversion.from === 'task' ? 'task to Order item' : 'Order item to task'}`
      : isMove ? `Save and move ${isTask ? 'task' : 'item'}` : 'Save changes')
    : `Add ${isTask ? 'task' : 'item'}`

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      sheetRef.current?.requestSubmit()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(sheetRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? [])]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleFinderKeyDown = (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (finderResults[0]) chooseEntry(finderResults[0])
    else startNewFromFinder(kind)
  }

  return (
    <div className="quick-capture" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <form aria-labelledby="quick-capture-title" aria-modal="true" className="quick-capture__sheet" onKeyDown={handleKeyDown} onSubmit={save} ref={sheetRef} role="dialog">
        <header className="quick-capture__header"><div><span className="section-kicker">QUICK</span><h2 id="quick-capture-title">Capture or edit</h2></div><button aria-label="Close Quick" className="icon-button" onClick={onClose} type="button">x</button></header>
        <div aria-label="Quick item type" className="quick-capture__mode" role="group"><button aria-pressed={isTask} disabled={Boolean(conversion)} onClick={() => selectKind('task')} type="button">Task</button><button aria-pressed={!isTask} disabled={Boolean(conversion)} onClick={() => selectKind('order')} type="button">Order</button></div>
        <section aria-label="Find an existing item or begin a new one" className="quick-capture__finder">
          <label><span>Find or start</span><input aria-label="Find a task or Order item" enterKeyHint="search" onChange={(event) => setFinderQuery(event.target.value)} onKeyDown={handleFinderKeyDown} placeholder="Search every task and Order item" ref={finderRef} type="search" value={finderQuery} /></label>
          <div className="quick-capture__finder-actions">
            <button disabled={!finderQuery.trim()} onClick={() => startNewFromFinder('task')} type="button">New task</button>
            <button disabled={!finderQuery.trim()} onClick={() => startNewFromFinder('order')} type="button">New Order item</button>
            <button onClick={pasteClipboard} type="button">Paste</button>
          </div>
          {finderResults.length ? <div aria-label={finderQuery ? 'Matching items' : 'Recent items'} className="quick-capture__results" role="list">
            {finderResults.map((entry) => <button className="quick-capture__result" key={`${entry.kind}:${entry.id}`} onClick={() => chooseEntry(entry)} type="button">
              <span className="quick-capture__result-kind">{entry.kind === 'task' ? 'Task' : 'Order'}</span>
              <strong>{entry.title}</strong>
              <small>{entry.subtitle}</small>
              {entry.details ? <em>{entry.details}</em> : null}
            </button>)}
          </div> : finderQuery ? <p className="quick-capture__empty">No match. Start a new {isTask ? 'task' : 'Order item'} from this search.</p> : null}
        </section>
        {conversion ? <section aria-live="polite" className="quick-capture__conversion">
          <div><strong>Converting {conversion.from === 'task' ? 'task to Order item' : 'Order item to task'}</strong><span>The source stays untouched until you confirm this conversion.</span></div>
          <button onClick={cancelConversion} type="button">Keep as {conversion.from === 'task' ? 'task' : 'Order item'}</button>
        </section> : canConvert ? <button className="quick-capture__conversion-action" onClick={isTask ? startTaskToOrderConversion : startOrderToTaskConversion} type="button">Convert to {isTask ? 'Order item' : 'task'}</button> : null}
        {isTask ? <>
          <label><span>{conversion ? 'Convert to task' : editingId ? 'Edit task' : 'Task'}</span><input autoCapitalize="sentences" enterKeyHint="done" onChange={(event) => setTask({ ...task, title: event.target.value })} placeholder="What needs doing?" ref={titleRef} value={task.title} /></label>
          <button aria-expanded={detailsOpen} className="quick-capture__details-toggle" onClick={() => setDetailsOpen((open) => !open)} type="button">{detailsOpen ? 'Hide details' : task.details ? 'Show details' : 'Add compact details'}</button>
          {detailsOpen ? <label><span>Details</span><textarea onChange={(event) => setTask({ ...task, details: event.target.value })} placeholder="Notes, context, or a checklist" rows={3} value={task.details} /></label> : null}
          <div className="quick-capture__grid">
            <label><span>Project</span><select onChange={(event) => changeTaskProject(event.target.value)} value={task.projectId}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label><span>Section</span><select onChange={(event) => changeTaskSection(event.target.value)} value={task.sectionId}><option value="">No section</option>{matchingSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
            <label><span>Date</span><input onChange={(event) => setTask({ ...task, date: event.target.value })} type="date" value={task.date} /></label>
            <label><span>Time</span><input disabled={!task.date} onChange={(event) => setTask({ ...task, time: event.target.value })} type="time" value={task.time} /></label>
          </div>
        </> : <>
          <label><span>{conversion ? 'Convert to Order item' : editingId ? 'Edit Order item' : 'Order item'}</span><input autoCapitalize="sentences" enterKeyHint="done" onChange={(event) => setOrder({ ...order, title: event.target.value })} placeholder="What comes next?" ref={titleRef} value={order.title} /></label>
          <button aria-expanded={detailsOpen} className="quick-capture__details-toggle" onClick={() => setDetailsOpen((open) => !open)} type="button">{detailsOpen ? 'Hide details' : order.details ? 'Show details' : 'Add compact details'}</button>
          {detailsOpen ? <label><span>Details</span><textarea onChange={(event) => setOrder({ ...order, details: event.target.value })} placeholder="Notes, context, or a checklist" rows={3} value={order.details} /></label> : null}
          <div className="quick-capture__grid">
            <label><span>Order section</span><select onChange={(event) => setOrder({ ...order, lane: event.target.value })} value={order.lane}>{QUICK_ORDER_LANES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {order.lane === 'after' ? <label><span>After</span><select onChange={(event) => setOrder({ ...order, relationId: event.target.value })} value={order.relationId}><option value="">Choose an item</option>{orderItems.filter((item) => item.id !== editingId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : null}
          </div>
        </>}
        <p aria-live="polite" className="quick-capture__destination">Destination: {destinationSummary}</p>
        {error ? <p className="quick-capture__error" role="alert">{error}</p> : null}
        <footer className="quick-capture__footer"><button className="secondary-button" onClick={onClose} type="button">Cancel</button><button className="quick-button" type="submit">{submitLabel}</button></footer>
      </form>
    </div>
  )
}
