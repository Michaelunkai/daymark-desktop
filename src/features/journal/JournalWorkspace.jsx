import { useEffect, useMemo, useRef, useState } from 'react'
import './journal.css'

const DIARY_PROMPTS = [
  { field: 'morning', label: 'Morning plan', placeholder: 'What is today about?' },
  { field: 'highlights', label: 'Highlights', placeholder: 'What went well?' },
  { field: 'reflection', label: 'Reflection', placeholder: 'What did you learn or feel?' },
  { field: 'tomorrow', label: 'Tomorrow', placeholder: 'What deserves attention next?' },
]

const MOODS = [
  { value: '', label: '—' },
  { value: 'great', label: 'Great' },
  { value: 'good', label: 'Good' },
  { value: 'okay', label: 'Okay' },
  { value: 'low', label: 'Low' },
  { value: 'rough', label: 'Rough' },
]

const DIARY_FIELDS = ['body', 'morning', 'highlights', 'reflection', 'tomorrow']

function toLocalDate(date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function addDays(dateText, days) {
  const date = new Date(dateText + 'T12:00:00')
  date.setDate(date.getDate() + days)
  return toLocalDate(date)
}

function dayLabel(dateText) {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(dateText + 'T12:00:00'))
  } catch {
    return dateText
  }
}

function longLabel(dateText) {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(dateText + 'T12:00:00'))
  } catch {
    return dateText
  }
}

function wordCount(text) {
  const trimmed = (text || '').trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/**
 * Local-draft law (round 3): editors never dispatch per keystroke. Drafts
 * commit debounced and on blur, and an all-empty draft is never committed, so
 * the store can never rewrite or reject mid-typing — spaces always work and
 * any character can be deleted. External updates (sync) are adopted only when
 * the editor is not focused, so the caret never jumps.
 */
function useLocalDraft({ record, fields, commit, delay = 600 }) {
  const [draft, setDraft] = useState(() => fields.map((f) => record?.[f] ?? ''))
  const [focused, setFocused] = useState(false)
  const commitRef = useRef(commit)
  commitRef.current = commit
  const draftKey = JSON.stringify(draft)
  const recordKey = JSON.stringify(fields.map((f) => record?.[f] ?? ''))

  useEffect(() => {
    if (focused) return
    setDraft((current) => {
      const next = fields.map((f) => record?.[f] ?? '')
      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })
  }, [recordKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!fields.some((_, i) => (draft[i] ?? '').trim())) return undefined
    const timer = window.setTimeout(() => {
      const patch = {}
      fields.forEach((f, i) => { patch[f] = draft[i] ?? '' })
      commitRef.current(patch)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [draftKey, delay]) // eslint-disable-line react-hooks/exhaustive-deps

  const commitNow = () => {
    if (!fields.some((_, i) => (draft[i] ?? '').trim())) return
    const patch = {}
    fields.forEach((f, i) => { patch[f] = draft[i] ?? '' })
    commitRef.current(patch)
  }

  const bind = (index) => ({
    value: draft[index] ?? '',
    'data-draft-field': fields[index],
    onChange: (event) => setDraft((current) => current.map((v, i) => (i === index ? event.target.value : v))),
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); commitNow() },
  })

  return { draft, bind }
}

function NoteEditorCard({ note, moveTargets, onComplete, onDelete, onMove, onNoteUpdate }) {
  const { draft, bind } = useLocalDraft({
    record: note,
    fields: ['title', 'body'],
    commit: (patch) => onNoteUpdate(note.id, patch),
  })
  const hasContent = draft.some((value) => value.trim())
  const done = Boolean(note.completedAt)

  return (
    <article className={`journal-note ${done ? 'is-done' : ''}`} data-note-id={note.id}>
      <header className="journal-note__head">
        <input
          aria-label="Note title"
          className="journal-note__title"
          placeholder="Untitled note"
          {...bind(0)}
        />
        <div className="journal-note__tools">
          <button className="journal-icon-btn" disabled={!hasContent} onClick={() => onComplete(note.id)} title={done ? 'Reopen note' : 'Mark done'} type="button">{done ? '↺' : '✓'}</button>
          <button aria-label="Delete note" className="journal-icon-btn journal-icon-btn--danger" onClick={() => onDelete(note.id)} title="Delete note" type="button">✕</button>
        </div>
      </header>
      <textarea
        aria-label="Note body"
        className="journal-note__body"
        placeholder="Write anything — spaces, new lines, any character, all yours."
        rows={Math.min(14, Math.max(3, (draft[1]?.split('\n').length ?? 1) + 1))}
        {...bind(1)}
      />
      <footer className="journal-note__foot">
        <span className="journal-note__meta">{wordCount(draft[1])} words · saves as you type</span>
        <span className="journal-note__moves">
          {moveTargets.up ? <button className="journal-chip" onClick={() => onMove(note.id, moveTargets.up)} type="button">Move up</button> : null}
          {moveTargets.down ? <button className="journal-chip" onClick={() => onMove(note.id, moveTargets.down)} type="button">Move down</button> : null}
        </span>
      </footer>
    </article>
  )
}

function NotesBoard({ notes, onNoteAdd, onNoteComplete, onNoteDelete, onNoteMove, onNoteUpdate }) {
  const open = notes.filter((note) => !note.completedAt)
  const done = notes.filter((note) => note.completedAt)
  const [showDone, setShowDone] = useState(false)

  return (
    <div className="journal-notes">
      <div className="journal-toolbar">
        <strong>{open.length} note{open.length === 1 ? '' : 's'}</strong>
        <button className="journal-primary" onClick={() => onNoteAdd({ title: '', body: '' })} type="button">
          <span aria-hidden="true">+</span> New note
        </button>
      </div>
      {open.length ? (
        <div className="journal-notes__list">
          {open.map((note, index) => (
            <NoteEditorCard
              key={note.id}
              moveTargets={{ up: open[index - 1]?.id ?? null, down: open[index + 1]?.id ?? null }}
              note={note}
              onComplete={onNoteComplete}
              onDelete={onNoteDelete}
              onMove={onNoteMove}
              onNoteUpdate={onNoteUpdate}
            />
          ))}
        </div>
      ) : (
        <div className="journal-empty">
          <strong>No notes yet</strong>
          <span>One tap on “New note” and start typing — everything saves by itself.</span>
        </div>
      )}
      {done.length ? (
        <div className="journal-notes__done">
          <button aria-expanded={showDone} className="journal-chip" onClick={() => setShowDone((v) => !v)} type="button">
            {showDone ? 'Hide' : 'Show'} {done.length} completed
          </button>
          {showDone ? done.map((note) => (
            <div className="journal-note__done-row" key={note.id}>
              <span>{note.title?.trim() || 'Untitled note'}</span>
              <div>
                <button className="journal-chip" onClick={() => onNoteComplete(note.id)} type="button">Reopen</button>
                <button className="journal-chip journal-chip--danger" onClick={() => onNoteDelete(note.id)} type="button">Delete</button>
              </div>
            </div>
          )) : null}
        </div>
      ) : null}
    </div>
  )
}

function DiaryWorkspace({ entries, onDiaryUpdate, onDiaryDelete }) {
  const today = useMemo(() => toLocalDate(new Date()), [])
  const [selected, setSelected] = useState(today)
  const [query, setQuery] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const entry = entries[selected]
  const record = entry ?? { body: '', morning: '', highlights: '', reflection: '', tomorrow: '', mood: '' }

  const { draft, bind } = useLocalDraft({
    record,
    fields: DIARY_FIELDS,
    commit: (patch) => {
      onDiaryUpdate(selected, { ...patch, mood: record.mood ?? '' })
      setSavedAt(new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date()))
    },
  })

  const setMood = (mood) => {
    const hasAny = mood || DIARY_FIELDS.some((_, i) => (draft[i] ?? '').trim())
    if (!hasAny) return
    const patch = {}
    DIARY_FIELDS.forEach((f, i) => { patch[f] = draft[i] ?? '' })
    onDiaryUpdate(selected, { ...patch, mood })
  }

  const strip = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)), [today])
  const timeline = useMemo(() => Object.values(entries)
    .filter((e) => !query.trim() || `${e.body} ${e.morning} ${e.highlights} ${e.reflection} ${e.tomorrow}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date)), [entries, query])
  const streak = useMemo(() => {
    let count = 0
    let cursor = today
    while (entries[cursor]) { count += 1; cursor = addDays(cursor, -1) }
    return count
  }, [entries, today])

  return (
    <div className="journal-diary">
      <div className="journal-toolbar">
        <strong>Diary</strong>
        <span className="journal-diary__streak" title="Consecutive days with an entry">{streak > 0 ? `🔥 ${streak}-day streak` : 'Start your streak today'}</span>
      </div>

      <div aria-label="Recent days" className="journal-strip" role="tablist">
        {strip.map((date) => (
          <button
            aria-selected={selected === date}
            className={`journal-strip__day ${selected === date ? 'is-selected' : ''} ${entries[date] ? 'has-entry' : ''}`}
            key={date}
            onClick={() => setSelected(date)}
            role="tab"
            title={entries[date] ? 'Entry exists' : 'No entry yet'}
            type="button"
          >
            <span className="journal-strip__label">{dayLabel(date)}</span>
            <span aria-hidden="true" className="journal-strip__dot" />
          </button>
        ))}
        <label className="journal-strip__jump">
          <span>Jump</span>
          <input onChange={(event) => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setSelected(event.target.value) }} type="date" value={selected} />
        </label>
      </div>

      <section aria-label={`Diary entry for ${longLabel(selected)}`} className="journal-diary__editor">
        <header className="journal-diary__editor-head">
          <div>
            <span className="section-kicker">{selected === today ? 'TODAY' : selected === addDays(today, -1) ? 'YESTERDAY' : 'ARCHIVE'}</span>
            <h2>{longLabel(selected)}</h2>
          </div>
          <div className="journal-diary__editor-tools">
            {savedAt ? <span className="journal-diary__saved" role="status">Saved {savedAt}</span> : null}
            <label className="journal-diary__mood" title="How was the day?">
              <span>Mood</span>
              <select onChange={(event) => setMood(event.target.value)} value={record.mood ?? ''}>
                {MOODS.map((mood) => <option key={mood.value} value={mood.value}>{mood.label}</option>)}
              </select>
            </label>
            {entry ? <button className="journal-chip journal-chip--danger" onClick={() => onDiaryDelete(selected)} type="button">Delete entry</button> : null}
          </div>
        </header>
        <textarea
          aria-label={`Diary body for ${selected}`}
          className="journal-diary__body"
          placeholder={selected === today ? 'How was your day? Write freely — it saves as you type.' : 'No entry for this day yet. Write one now.'}
          rows={Math.min(20, Math.max(8, (draft[0]?.split('\n').length ?? 1) + 2))}
          {...bind(0)}
        />
        <details className="journal-diary__prompts">
          <summary>Guided prompts <small>(optional)</small></summary>
          <div>
            {DIARY_PROMPTS.map((prompt, i) => (
              <label key={prompt.field}>
                <span>{prompt.label}</span>
                <textarea placeholder={prompt.placeholder} rows={2} {...bind(i + 1)} />
              </label>
            ))}
          </div>
        </details>
      </section>

      <section aria-label="All entries" className="journal-diary__timeline">
        <header>
          <h3>All entries <small>{timeline.length}</small></h3>
          <input aria-label="Search entries" onChange={(event) => setQuery(event.target.value)} placeholder="Search your diary…" value={query} />
        </header>
        {timeline.length ? timeline.map((e) => (
          <button className="journal-diary__entry" key={e.date} onClick={() => setSelected(e.date)} type="button">
            <span className="journal-diary__entry-date">{longLabel(e.date)}</span>
            <span className="journal-diary__entry-preview">{(e.body || e.morning || e.highlights || '…').trim().slice(0, 140)}</span>
            <span className="journal-diary__entry-meta">{wordCount(e.body) + wordCount(e.morning) + wordCount(e.highlights) + wordCount(e.reflection)} words{e.mood ? ` · ${e.mood}` : ''}</span>
          </button>
        )) : (
          <p className="journal-diary__empty">{query ? 'No entries match that search.' : 'Your diary history will gather here day by day.'}</p>
        )}
      </section>
    </div>
  )
}

export function JournalWorkspace({
  journal,
  onDiaryDelete,
  onDiaryUpdate,
  onNoteAdd,
  onNoteComplete,
  onNoteDelete,
  onNoteMove,
  onNoteUpdate,
  route,
}) {
  return route === 'diary' ? (
    <DiaryWorkspace entries={journal.diaryEntries} onDiaryDelete={onDiaryDelete} onDiaryUpdate={onDiaryUpdate} />
  ) : (
    <NotesBoard notes={journal.notes} onNoteAdd={onNoteAdd} onNoteComplete={onNoteComplete} onNoteDelete={onNoteDelete} onNoteMove={onNoteMove} onNoteUpdate={onNoteUpdate} />
  )
}
