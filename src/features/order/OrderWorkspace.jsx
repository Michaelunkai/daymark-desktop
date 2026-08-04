import { useMemo, useState } from 'react'

import './order.css'

const LANES = [
  { id: 'now', label: 'Do now', hint: 'The next actions worth attention.' },
  { id: 'later', label: 'Later', hint: 'Useful, but not for this moment.' },
  { id: 'after', label: 'After', hint: 'Sequence after another item.' },
  { id: 'before', label: 'Before', hint: 'Sequence before another item.' },
]

const PRIORITIES = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Low' },
  { value: 4, label: 'Normal' },
]

export function OrderWorkspace({ items, onAdd, onUpdate, onDelete, onMove }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const orderedItems = useMemo(
    () => [...items].sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt)),
    [items],
  )
  const relationOptions = orderedItems.filter((item) => item.id !== draft?.id)

  const openCreate = () => {
    setEditing('create')
    setDraft({ title: '', details: '', lane: 'now', relationId: null, priority: 4, status: 'open' })
  }

  const openEdit = (item) => {
    setEditing(item.id)
    setDraft({ ...item })
  }

  const closeEditor = () => {
    setEditing(null)
    setDraft(null)
  }

  const save = (event) => {
    event.preventDefault()
    if (!draft?.title.trim()) return
    if (editing === 'create') onAdd(draft)
    else onUpdate(editing, draft)
    closeEditor()
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

  return (
    <section aria-labelledby="order-title" className="order-workspace">
      <header className="order-header">
        <div>
          <span className="section-kicker">WORKSPACE ORGANIZER</span>
          <h1 id="order-title">Order</h1>
          <p>Turn loose thoughts into a sequence you can actually follow.</p>
        </div>
        <button className="primary-button" onClick={openCreate} type="button">
          <span aria-hidden="true">+</span>
          Add item
        </button>
      </header>

      <div className="order-intro">
        <strong>{orderedItems.length ? `${orderedItems.length} sequenced items` : 'A clear place to decide what comes next'}</strong>
        <span>Items stay local and are saved with the rest of your workspace.</span>
      </div>

      {orderedItems.length ? (
        <div className="order-lanes">
          {grouped.map((lane) => (
            <section
              className={`order-lane order-lane--${lane.id}`}
              key={lane.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggingId) onUpdate(draggingId, { lane: lane.id, relationId: null })
                setDraggingId(null)
              }}
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
                  <article
                    className={`order-item ${draggingId === item.id ? 'is-dragging' : ''}`}
                    draggable
                    key={item.id}
                    onDragEnd={() => setDraggingId(null)}
                    onDragStart={() => setDraggingId(item.id)}
                  >
                    <button
                      aria-label={`Drag ${item.title}`}
                      className="order-item__grip"
                      title="Drag to reorder"
                      type="button"
                    >
                      ::
                    </button>
                    <div className="order-item__body">
                      <div className="order-item__title-row">
                        <button className="order-item__title" onClick={() => openEdit(item)} type="button">{item.title}</button>
                        <span className={`order-priority order-priority--${item.priority}`}>{PRIORITIES.find((priority) => priority.value === item.priority)?.label}</span>
                      </div>
                      {item.details ? <p>{item.details}</p> : null}
                      <div className="order-item__meta">
                        <span className={`order-status order-status--${item.status}`}>{item.status}</span>
                        {item.relationId ? <span>with {orderedItems.find((candidate) => candidate.id === item.relationId)?.title ?? 'another item'}</span> : null}
                      </div>
                    </div>
                    <div className="order-item__actions">
                      <button aria-label={`Move ${item.title} earlier`} disabled={index === 0} onClick={() => moveBy(item, -1)} title="Move earlier" type="button">^</button>
                      <button aria-label={`Move ${item.title} later`} disabled={index === lane.items.length - 1} onClick={() => moveBy(item, 1)} title="Move later" type="button">v</button>
                      <button aria-label={`Edit ${item.title}`} onClick={() => openEdit(item)} title="Edit item" type="button">Edit</button>
                      <button aria-label={`Delete ${item.title}`} onClick={() => onDelete(item)} title="Delete item" type="button">x</button>
                    </div>
                  </article>
                )) : <p className="order-lane__empty">Drop an item here or add one below.</p>}
              </div>
              <button className="order-lane__add" onClick={openCreate} type="button"><span aria-hidden="true">+</span> Add to {lane.label.toLowerCase()}</button>
            </section>
          ))}
        </div>
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
          <form aria-labelledby="order-editor-title" className="order-editor" onSubmit={save}>
            <div className="order-editor__header">
              <div>
                <span className="section-kicker">ORDER ITEM</span>
                <h2 id="order-editor-title">{editing === 'create' ? 'Add to the sequence' : 'Edit sequence item'}</h2>
              </div>
              <button aria-label="Close Order editor" className="icon-button" onClick={closeEditor} title="Close" type="button">x</button>
            </div>
            <label>Title<input autoFocus onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
            <label>Details<textarea onChange={(event) => setDraft({ ...draft, details: event.target.value })} rows={3} value={draft.details} /></label>
            <div className="order-editor__grid">
              <label>Group<select onChange={(event) => setDraft({ ...draft, lane: event.target.value, relationId: event.target.value === 'now' || event.target.value === 'later' ? null : draft.relationId })} value={draft.lane}>{LANES.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}</select></label>
              <label>Priority<select onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })} value={draft.priority}>{PRIORITIES.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}</select></label>
              <label>Status<select onChange={(event) => setDraft({ ...draft, status: event.target.value })} value={draft.status}><option value="open">Open</option><option value="done">Done</option><option value="blocked">Blocked</option></select></label>
            </div>
            {draft.lane === 'after' || draft.lane === 'before' ? (
              <label>{draft.lane === 'after' ? 'After item' : 'Before item'}<select onChange={(event) => setDraft({ ...draft, relationId: event.target.value || null })} value={draft.relationId ?? ''}><option value="">Choose a related item</option>{relationOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            ) : null}
            <footer className="order-editor__actions"><button className="secondary-button" onClick={closeEditor} type="button">Cancel</button><button className="primary-button" type="submit">Save item</button></footer>
          </form>
        </div>
      ) : null}
    </section>
  )
}
