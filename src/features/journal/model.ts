export const LEGACY_JOURNAL_STORAGE_KEY = 'daymark.journal.v1'
export const JOURNAL_STORAGE_VERSION = 1

export type Note = {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export type DiaryEntry = {
  date: string
  body: string
  updatedAt: string
}

export type JournalSnapshot = {
  version: typeof JOURNAL_STORAGE_VERSION
  notes: Note[]
  diary: Record<string, DiaryEntry>
}

export function emptyJournal(): JournalSnapshot {
  return { version: JOURNAL_STORAGE_VERSION, notes: [], diary: {} }
}

export function readLegacyJournal(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  key = LEGACY_JOURNAL_STORAGE_KEY,
): JournalSnapshot | null {
  try {
    const raw = storage?.getItem(key)
    return raw ? parseJournal(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function clearLegacyJournal(
  storage: Pick<Storage, 'removeItem'> | null | undefined,
  key = LEGACY_JOURNAL_STORAGE_KEY,
): void {
  try {
    storage?.removeItem(key)
  } catch {
    // Legacy cleanup is best effort.
  }
}

export function upsertNote(snapshot: JournalSnapshot, input: { id?: string; title: string; body: string }, now: string): JournalSnapshot {
  const title = input.title.trim() || 'Untitled note'
  const body = input.body.trim()
  const existing = input.id ? snapshot.notes.find((note) => note.id === input.id) : undefined
  const note = existing
    ? { ...existing, title, body, updatedAt: now }
    : { id: input.id ?? `note-${now}-${snapshot.notes.length}`, title, body, createdAt: now, updatedAt: now }
  return {
    ...snapshot,
    notes: [note, ...snapshot.notes.filter((item) => item.id !== note.id)],
  }
}

export function removeNote(snapshot: JournalSnapshot, id: string): JournalSnapshot {
  return { ...snapshot, notes: snapshot.notes.filter((note) => note.id !== id) }
}

export function upsertDiary(snapshot: JournalSnapshot, date: string, body: string, now: string): JournalSnapshot {
  const nextDiary = { ...snapshot.diary }
  if (body.trim()) nextDiary[date] = { date, body: body.trim(), updatedAt: now }
  else delete nextDiary[date]
  return { ...snapshot, diary: nextDiary }
}

export function parseJournal(value: unknown): JournalSnapshot {
  if (!isRecord(value) || value.version !== JOURNAL_STORAGE_VERSION) return emptyJournal()
  const notes = Array.isArray(value.notes) ? value.notes.filter(isNote).map((note) => ({ ...note })) : []
  const diary = isRecord(value.diary)
    ? Object.fromEntries(Object.entries(value.diary).filter(([, entry]) => isDiaryEntry(entry)).map(([date, entry]) => [date, { ...(entry as DiaryEntry) }]))
    : {}
  return { version: JOURNAL_STORAGE_VERSION, notes, diary }
}

function isNote(value: unknown): value is Note {
  return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.body === 'string' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
}

function isDiaryEntry(value: unknown): value is DiaryEntry {
  return isRecord(value) && typeof value.date === 'string' && typeof value.body === 'string' && typeof value.updatedAt === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
