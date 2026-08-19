import { useEffect, useMemo, useRef, useState } from 'react'
import './quick-capture.css'

const ORDER_LANES = [['now', 'Do now'], ['later', 'Later'], ['after', 'After']]

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
  onSaveOrder,
  onSaveTask,
  orderItems,
  projects,
  sections,
  tasks,
}) {
  const [kind, setKind] = useState('task')
  const [editingId, setEditingId] = useState('')
  const [task, setTask] = useState(() => emptyTask(inboxProjectId))
  const [order, setOrder] = useState(emptyOrder)
  const [error, setError] = useState('')
  const sheetRef = useRef(null)
  const returnFocusRef = useRef(null)
  const matchingSections = useMemo(() => sections.filter((section) => section.projectId === task.projectId), [sections, task.projectId])

  useEffect(() => {
    if (!isOpen) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setKind('task')
    setEditingId('')
    setTask(emptyTask(inboxProjectId))
    setOrder(emptyOrder())
    setError('')
    const focusFrame = requestAnimationFrame(() => {
      sheetRef.current?.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')?.focus()
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
    setError('')
    if (nextKind === 'task') setTask(emptyTask(inboxProjectId))
    else setOrder(emptyOrder())
  }
  const chooseTask = (id) => {
    setEditingId(id)
    const source = tasks.find((candidate) => candidate.id === id)
    if (!source) {
      setTask(emptyTask(inboxProjectId))
      return
    }
    setTask({ title: source.content, details: source.description ?? '', projectId: source.projectId, sectionId: source.sectionId ?? '', date: source.due?.date ?? '', time: source.due?.time ?? '', priority: source.priority })
  }
  const chooseOrder = (id) => {
    setEditingId(id)
    const source = orderItems.find((candidate) => candidate.id === id)
    if (!source) {
      setOrder(emptyOrder())
      return
    }
    setOrder({ title: source.title, details: source.details ?? '', lane: source.lane, relationId: source.relationId ?? '', priority: source.priority })
  }
  const save = (event) => {
    event.preventDefault()
    const result = kind === 'task'
      ? (!task.title.trim() ? { ok: false, message: 'Add a task name.' } : onSaveTask(editingId || null, {
        content: task.title, description: task.details, projectId: task.projectId, sectionId: task.sectionId || null,
        priority: Number(task.priority), due: task.date ? { date: task.date, time: task.time || null, timezone: null, recurrence: null } : null,
      }))
      : (!order.title.trim() ? { ok: false, message: 'Add an Order item name.' } : onSaveOrder(editingId || null, {
        title: order.title, details: order.details, lane: order.lane, relationId: order.lane === 'after' ? order.relationId || null : null, priority: Number(order.priority),
      }))
    if (!result?.ok) {
      setError(result?.message ?? 'Daymark could not save that item.')
      return
    }
    onClose()
  }

  const isTask = kind === 'task'
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
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
  return (
    <div className="quick-capture" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form aria-labelledby="quick-capture-title" aria-modal="true" className="quick-capture__sheet" onKeyDown={handleKeyDown} onSubmit={save} ref={sheetRef} role="dialog">
        <header className="quick-capture__header"><div><span className="section-kicker">QUICK</span><h2 id="quick-capture-title">Capture or edit</h2></div><button aria-label="Close Quick" className="icon-button" onClick={onClose} type="button">x</button></header>
        <div aria-label="Quick item type" className="quick-capture__mode" role="group"><button aria-pressed={isTask} onClick={() => selectKind('task')} type="button">Task</button><button aria-pressed={!isTask} onClick={() => selectKind('order')} type="button">Order</button></div>
        <label><span>{editingId ? `Edit ${isTask ? 'task' : 'Order item'}` : `Create ${isTask ? 'task' : 'Order item'}`}</span><select aria-label="Quick item to edit" onChange={(event) => isTask ? chooseTask(event.target.value) : chooseOrder(event.target.value)} value={editingId}><option value="">New {isTask ? 'task' : 'Order item'}</option>{(isTask ? tasks : orderItems).map((item) => <option key={item.id} value={item.id}>{isTask ? item.content : item.title}</option>)}</select></label>
        {isTask ? <>
          <label><span>Task</span><input autoFocus onChange={(event) => setTask({ ...task, title: event.target.value })} placeholder="What needs doing?" value={task.title} /></label>
          <label><span>Details</span><textarea onChange={(event) => setTask({ ...task, details: event.target.value })} rows={3} value={task.details} /></label>
          <div className="quick-capture__grid">
            <label><span>Project</span><select onChange={(event) => setTask({ ...task, projectId: event.target.value, sectionId: '' })} value={task.projectId}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label><span>Section</span><select onChange={(event) => setTask({ ...task, sectionId: event.target.value })} value={task.sectionId}><option value="">No section</option>{matchingSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
            <label><span>Date</span><input onChange={(event) => setTask({ ...task, date: event.target.value })} type="date" value={task.date} /></label>
            <label><span>Time</span><input disabled={!task.date} onChange={(event) => setTask({ ...task, time: event.target.value })} type="time" value={task.time} /></label>
          </div>
        </> : <>
          <label><span>Order item</span><input autoFocus onChange={(event) => setOrder({ ...order, title: event.target.value })} placeholder="What comes next?" value={order.title} /></label>
          <label><span>Details</span><textarea onChange={(event) => setOrder({ ...order, details: event.target.value })} rows={3} value={order.details} /></label>
          <div className="quick-capture__grid">
            <label><span>Order section</span><select onChange={(event) => setOrder({ ...order, lane: event.target.value, relationId: event.target.value === 'after' ? order.relationId : '' })} value={order.lane}>{ORDER_LANES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {order.lane === 'after' ? <label><span>After</span><select onChange={(event) => setOrder({ ...order, relationId: event.target.value })} value={order.relationId}><option value="">Choose an item</option>{orderItems.filter((item) => item.id !== editingId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : null}
          </div>
        </>}
        {error ? <p className="quick-capture__error" role="alert">{error}</p> : null}
        <footer className="quick-capture__footer"><button className="secondary-button" onClick={onClose} type="button">Cancel</button><button className="quick-button" type="submit">{editingId ? 'Save changes' : `Add ${isTask ? 'task' : 'item'}`}</button></footer>
      </form>
    </div>
  )
}
