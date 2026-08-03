import { emptyJournal, parseJournal, removeNote, upsertDiary, upsertNote } from './model'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const now = '2026-08-03T10:00:00.000Z'
let journal = emptyJournal()
journal = upsertNote(journal, { title: 'Release notes', body: 'Capture the acceptance result.' }, now)
assert(journal.notes.length === 1 && journal.notes[0].title === 'Release notes', 'A note should be added.')

journal = upsertNote(journal, { id: journal.notes[0].id, title: '', body: 'Updated body' }, now)
assert(journal.notes.length === 1 && journal.notes[0].title === 'Untitled note' && journal.notes[0].body === 'Updated body', 'A note should update in place.')

journal = upsertDiary(journal, '2026-08-03', 'A focused workday.', now)
assert(journal.diary['2026-08-03'].body === 'A focused workday.', 'A diary entry should be stored by date.')
journal = upsertDiary(journal, '2026-08-03', '   ', now)
assert(!journal.diary['2026-08-03'], 'Blank diary entries should be removed.')

journal = removeNote(journal, journal.notes[0].id)
assert(journal.notes.length === 0, 'A note should be removable.')
assert(parseJournal({ version: 99, notes: [], diary: {} }).notes.length === 0, 'Unsupported journal versions should recover empty.')

console.log('JOURNAL_MODEL_TESTS_OK')
