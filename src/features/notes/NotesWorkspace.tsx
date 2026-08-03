import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { IconButton } from "../../components/ui";
import { createId } from "../../core/sample-data";
import type {
  DiaryEntry,
  DiaryEntryInput,
  DiaryEntryPatch,
  DispatchResult,
  Note,
  NoteInput,
  NotePatch,
  UserAction,
} from "../../core/types";
import {
  countWords,
  formatDiaryDate,
  getDiaryDates,
  parseTags,
  relativeDiaryDate,
  searchWriting,
  sortDiaryEntries,
  sortNotes,
  todayLocalDate,
  type WritingMode,
} from "./model";
import "./notes.css";

export type NotesAction = Extract<
  UserAction,
  {
    type:
      | "note.add"
      | "note.update"
      | "note.delete"
      | "diary.add"
      | "diary.update"
      | "diary.delete";
  }
>;

export type NotesDispatch = (action: NotesAction) => DispatchResult;

export interface NotesWorkspaceProps {
  notes: readonly Note[];
  diaryEntries: readonly DiaryEntry[];
  onDispatch: NotesDispatch;
  initialMode?: WritingMode;
  className?: string;
}

type NoteDraft = {
  title: string;
  content: string;
  tags: string;
  isPinned: boolean;
};

type DiaryDraft = {
  date: string;
  title: string;
  content: string;
  mood: DiaryEntry["mood"] | "";
  tags: string;
  isFavorite: boolean;
};

type EditorState =
  | { kind: "note"; id: string | null }
  | { kind: "diary"; id: string | null };

const MOODS: Array<{ value: NonNullable<DiaryEntry["mood"]>; label: string }> = [
  { value: "great", label: "Great" },
  { value: "good", label: "Good" },
  { value: "okay", label: "Okay" },
  { value: "low", label: "Low" },
  { value: "rough", label: "Rough" },
];

const EMPTY_NOTE: NoteDraft = {
  title: "",
  content: "",
  tags: "",
  isPinned: false,
};

function makeDiaryDraft(date = todayLocalDate()): DiaryDraft {
  return {
    date,
    title: "",
    content: "",
    mood: "",
    tags: "",
    isFavorite: false,
  };
}

function noteToDraft(note: Note): NoteDraft {
  return {
    title: note.title,
    content: note.content,
    tags: note.tags.join(", "),
    isPinned: note.isPinned,
  };
}

function diaryToDraft(entry: DiaryEntry): DiaryDraft {
  return {
    date: entry.date,
    title: entry.title,
    content: entry.content,
    mood: entry.mood ?? "",
    tags: entry.tags.join(", "),
    isFavorite: entry.isFavorite,
  };
}

export function NotesWorkspace({
  notes,
  diaryEntries,
  onDispatch,
  initialMode = "notes",
  className = "",
}: NotesWorkspaceProps) {
  const titleId = useId().replace(/:/g, "");
  const [mode, setMode] = useState<WritingMode>(initialMode);
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayLocalDate());
  const [editor, setEditor] = useState<EditorState>({ kind: initialMode, id: null });
  const [noteDraft, setNoteDraft] = useState<NoteDraft>(EMPTY_NOTE);
  const [diaryDraft, setDiaryDraft] = useState<DiaryDraft>(() => makeDiaryDraft());
  const [error, setError] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const [keyboardResultIndex, setKeyboardResultIndex] = useState(0);

  const sortedNotes = useMemo(() => sortNotes(notes.filter((note) => !note.isArchived)), [notes]);
  const diaryDates = useMemo(() => getDiaryDates(diaryEntries), [diaryEntries]);
  const searchableItems = useMemo(
    () => searchWriting(mode, query, sortedNotes, diaryEntries),
    [diaryEntries, mode, query, sortedNotes],
  );
  const diaryItems = useMemo(
    () => (query.trim() ? searchableItems.map((result) => result.item as DiaryEntry) : sortDiaryEntries(diaryEntries, selectedDate)),
    [diaryEntries, query, searchableItems, selectedDate],
  );
  const resultItems = mode === "notes"
    ? searchableItems.map((result) => result.item as Note)
    : diaryItems;
  const listIsEmpty = mode === "notes" ? searchableItems.length === 0 : diaryItems.length === 0;
  const activeNote = editor.kind === "note" && editor.id ? notes.find((note) => note.id === editor.id) : undefined;
  const activeDiaryEntry = editor.kind === "diary" && editor.id
    ? diaryEntries.find((entry) => entry.id === editor.id)
    : undefined;

  useEffect(() => {
    setDeletePending(false);
    setError("");
    if (mode === "notes") {
      const first = sortedNotes[0];
      if (editor.kind !== "note" || (editor.id && !notes.some((note) => note.id === editor.id))) {
        if (first) {
          setEditor({ kind: "note", id: first.id });
          setNoteDraft(noteToDraft(first));
        } else {
          setEditor({ kind: "note", id: null });
          setNoteDraft(EMPTY_NOTE);
        }
      }
      return;
    }

    const first = diaryItems[0];
    if (editor.kind !== "diary" || (editor.id && !diaryEntries.some((entry) => entry.id === editor.id))) {
      if (first) {
        setEditor({ kind: "diary", id: first.id });
        setDiaryDraft(diaryToDraft(first));
        setSelectedDate(first.date);
      } else {
        setEditor({ kind: "diary", id: null });
        setDiaryDraft(makeDiaryDraft(selectedDate));
      }
    }
  }, [diaryEntries, diaryItems, editor.id, editor.kind, mode, notes, selectedDate, sortedNotes]);

  useEffect(() => {
    setKeyboardResultIndex((current) => Math.min(current, Math.max(0, resultItems.length - 1)));
  }, [resultItems.length]);

  function selectResultAt(index: number) {
    const item = resultItems[index];
    if (!item) return;
    if (mode === "notes") selectNote(item as Note);
    else selectDiaryEntry(item as DiaryEntry);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!resultItems.length) return;
      setKeyboardResultIndex((current) => {
        if (event.key === "Home") return 0;
        if (event.key === "End") return resultItems.length - 1;
        const offset = event.key === "ArrowDown" ? 1 : -1;
        return (current + offset + resultItems.length) % resultItems.length;
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectResultAt(keyboardResultIndex);
    }
  }

  function selectMode(nextMode: WritingMode) {
    setMode(nextMode);
    setQuery("");
    setKeyboardResultIndex(0);
    setDeletePending(false);
    setError("");
  }

  function startNew(kind = mode, diaryDate = selectedDate) {
    setDeletePending(false);
    setError("");
    if (kind === "notes") {
      setEditor({ kind: "note", id: null });
      setNoteDraft(EMPTY_NOTE);
    } else {
      setEditor({ kind: "diary", id: null });
      setDiaryDraft(makeDiaryDraft(diaryDate));
    }
  }

  function selectNote(note: Note) {
    setDeletePending(false);
    setError("");
    setEditor({ kind: "note", id: note.id });
    setNoteDraft(noteToDraft(note));
  }

  function selectDiaryEntry(entry: DiaryEntry) {
    setDeletePending(false);
    setError("");
    setSelectedDate(entry.date);
    setEditor({ kind: "diary", id: entry.id });
    setDiaryDraft(diaryToDraft(entry));
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const result = mode === "notes" ? saveNote() : saveDiaryEntry();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDeletePending(false);
  }

  function saveNote(): DispatchResult {
    const input: NoteInput = {
      title: noteDraft.title,
      content: noteDraft.content,
      tags: parseTags(noteDraft.tags),
      isPinned: noteDraft.isPinned,
    };
    if (editor.id) {
      const patch: NotePatch = input;
      const result = onDispatch({ type: "note.update", noteId: editor.id, patch });
      if (result.ok) setNoteDraft(noteToDraft(result.state.notes[editor.id]));
      return result;
    }
    const id = createId("note");
    const result = onDispatch({ type: "note.add", input: { ...input, id } });
    if (result.ok) {
      const created = result.state.notes[id];
      if (created) {
        setEditor({ kind: "note", id: created.id });
        setNoteDraft(noteToDraft(created));
      }
    }
    return result;
  }

  function saveDiaryEntry(): DispatchResult {
    const input: DiaryEntryInput = {
      date: diaryDraft.date,
      title: diaryDraft.title,
      content: diaryDraft.content,
      mood: diaryDraft.mood || null,
      tags: parseTags(diaryDraft.tags),
      isFavorite: diaryDraft.isFavorite,
    };
    if (editor.id) {
      const patch: DiaryEntryPatch = input;
      const result = onDispatch({ type: "diary.update", entryId: editor.id, patch });
      if (result.ok) {
        setDiaryDraft(diaryToDraft(result.state.diaryEntries[editor.id]));
        setSelectedDate(diaryDraft.date);
      }
      return result;
    }
    const id = createId("diary");
    const result = onDispatch({ type: "diary.add", input: { ...input, id } });
    if (result.ok) {
      const created = result.state.diaryEntries[id];
      if (created) {
        setEditor({ kind: "diary", id: created.id });
        setDiaryDraft(diaryToDraft(created));
        setSelectedDate(created.date);
      }
    }
    return result;
  }

  function deleteActive() {
    if (!editor.id) return;
    const result = editor.kind === "note"
      ? onDispatch({ type: "note.delete", noteId: editor.id })
      : onDispatch({ type: "diary.delete", entryId: editor.id });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDeletePending(false);
    startNew(editor.kind === "note" ? "notes" : "diary");
  }

  return (
    <section className={`notes-workspace ${className}`.trim()} aria-labelledby={`${titleId}-heading`}>
      <header className="notes-workspace__header">
        <div>
          <p className="notes-workspace__eyebrow">Writing</p>
          <h1 id={`${titleId}-heading`}>Notes &amp; diary</h1>
          <p className="notes-workspace__subtitle">
            Keep ideas and lived context close to the work, stored locally on this device.
          </p>
        </div>
        <div className="notes-workspace__header-actions">
          <div className="notes-workspace__mode-switch" role="tablist" aria-label="Writing type">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "notes"}
              className={mode === "notes" ? "is-selected" : ""}
              onClick={() => selectMode("notes")}
            >
              Notes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "diary"}
              className={mode === "diary" ? "is-selected" : ""}
              onClick={() => selectMode("diary")}
            >
              Diary
            </button>
          </div>
          <button className="notes-workspace__primary-button" type="button" onClick={() => startNew()}>
            <PlusIcon />
            New {mode === "notes" ? "note" : "entry"}
          </button>
        </div>
      </header>

      <div className="notes-workspace__toolbar">
        <label className="notes-workspace__search">
          <SearchIcon />
          <span className="visually-hidden">Search {mode}</span>
          <input
            aria-activedescendant={resultItems[keyboardResultIndex] ? `${titleId}-result-${resultItems[keyboardResultIndex].id}` : undefined}
            aria-controls={`${titleId}-results`}
            type="search"
            value={query}
            onChange={(event) => {
              setKeyboardResultIndex(0);
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={`Search ${mode === "notes" ? "notes" : "diary entries"}`}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear writing search"
              title="Clear search"
              onClick={() => {
                setKeyboardResultIndex(0);
                setQuery("");
              }}
            >
              <CloseIcon />
            </button>
          ) : null}
        </label>
        <span className="notes-workspace__privacy">
          <LockIcon />
          Saved on this device only
        </span>
      </div>

      {mode === "diary" ? (
        <div className="notes-workspace__datebar">
          <label htmlFor={`${titleId}-date`}>Browse by date</label>
          <input
            id={`${titleId}-date`}
            type="date"
            value={selectedDate}
            onChange={(event) => {
              const nextDate = event.currentTarget.value || selectedDate;
              setSelectedDate(nextDate);
              setKeyboardResultIndex(0);
              setQuery("");
              startNew("diary", nextDate);
            }}
          />
          <div className="notes-workspace__date-links" aria-label="Recent diary dates">
            {diaryDates.slice(0, 8).map((date) => (
              <button
                key={date}
                className={date === selectedDate && !query ? "is-selected" : ""}
                type="button"
                onClick={() => {
                  setSelectedDate(date);
                  setKeyboardResultIndex(0);
                  setQuery("");
                  startNew("diary", date);
                }}
              >
                {relativeDiaryDate(date)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="notes-workspace__body">
        <aside className="notes-workspace__index" aria-label={`${mode} list`}>
          <div className="notes-workspace__index-heading">
            <span>{query ? "Search results" : mode === "notes" ? "Your notes" : selectedDate === todayLocalDate() ? "Today" : formatDiaryDate(selectedDate, { month: "long", day: "numeric", year: "numeric" })}</span>
            <span>{mode === "notes" ? searchableItems.length : diaryItems.length}</span>
          </div>
          <div className="notes-workspace__index-list" id={`${titleId}-results`} role="listbox">
            {mode === "notes"
              ? searchableItems.map((result, index) => {
                  const note = result.item as Note;
                  return (
                    <button
                      aria-selected={keyboardResultIndex === index}
                      id={`${titleId}-result-${note.id}`}
                      role="option"
                      key={note.id}
                      type="button"
                      className={`notes-workspace__index-item ${editor.id === note.id ? "is-selected" : ""} ${keyboardResultIndex === index ? "is-keyboard-active" : ""}`}
                      onClick={() => {
                        setKeyboardResultIndex(index);
                        selectNote(note);
                      }}
                    >
                      <span className="notes-workspace__index-item-title">
                        {note.isPinned ? <PinIcon /> : null}
                        {note.title || "Untitled note"}
                      </span>
                      <span>{note.content || "No content yet"} · {relativeTime(note.updatedAt)}</span>
                    </button>
                  );
                })
              : diaryItems.map((entry, index) => (
                <button
                  aria-selected={keyboardResultIndex === index}
                  id={`${titleId}-result-${entry.id}`}
                  role="option"
                  key={entry.id}
                  type="button"
                  className={`notes-workspace__index-item ${editor.id === entry.id ? "is-selected" : ""} ${keyboardResultIndex === index ? "is-keyboard-active" : ""}`}
                  onClick={() => {
                    setKeyboardResultIndex(index);
                    selectDiaryEntry(entry);
                  }}
                >
                    <span className="notes-workspace__index-item-title">
                      {entry.isFavorite ? <FavoriteIcon /> : null}
                      {entry.title || "Untitled entry"}
                    </span>
                    <span>{entry.content || "No content yet"} · {countWords(entry.content)} words</span>
                  </button>
                ))}
            {listIsEmpty ? (
              <div className="notes-workspace__empty-list">
                <BookIcon />
                <strong>{query ? "Nothing matched" : `No ${mode} yet`}</strong>
                <span>{query ? "Try a title, tag, or phrase from the body." : "Start with a small thought and let it grow."}</span>
              </div>
            ) : null}
          </div>
        </aside>

        <form className="notes-workspace__editor" onSubmit={save}>
          <div className="notes-workspace__editor-topline">
            <span>{editor.id ? "Editing" : "New draft"}</span>
            {mode === "diary" && activeDiaryEntry ? <span>{formatDiaryDate(activeDiaryEntry.date)}</span> : null}
            {mode === "notes" && activeNote ? <span>Updated {relativeTime(activeNote.updatedAt)}</span> : null}
          </div>

          {mode === "notes" ? (
            <>
              <input
                className="notes-workspace__title-input"
                aria-label="Note title"
                value={noteDraft.title}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setNoteDraft((draft) => ({ ...draft, title: value }));
                }}
                placeholder="Untitled note"
              />
              <textarea
                className="notes-workspace__content-input"
                aria-label="Note content"
                value={noteDraft.content}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setNoteDraft((draft) => ({ ...draft, content: value }));
                }}
                placeholder="Write down an idea, reference, or anything worth keeping..."
              />
              <MetadataRow>
                <label className="notes-workspace__meta-field">
                  <span>Tags</span>
                  <input
                    aria-label="Note tags"
                    value={noteDraft.tags}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setNoteDraft((draft) => ({ ...draft, tags: value }));
                    }}
                    placeholder="work, ideas"
                  />
                </label>
                <label className="notes-workspace__check-field">
                  <input
                    type="checkbox"
                    checked={noteDraft.isPinned}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setNoteDraft((draft) => ({ ...draft, isPinned: checked }));
                    }}
                  />
                  <span>Pin note</span>
                </label>
                <span className="notes-workspace__word-count">{countWords(noteDraft.content)} words</span>
              </MetadataRow>
            </>
          ) : (
            <>
              <div className="notes-workspace__diary-title-row">
                <input
                  className="notes-workspace__title-input"
                  aria-label="Diary entry title"
                  value={diaryDraft.title}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDiaryDraft((draft) => ({ ...draft, title: value }));
                  }}
                  placeholder="A title for today"
                />
                <label className="notes-workspace__date-input">
                  <span>Date</span>
                  <input
                    aria-label="Diary entry date"
                    type="date"
                    value={diaryDraft.date}
                    onChange={(event) => {
                      const value = event.currentTarget.value || diaryDraft.date;
                      setDiaryDraft((draft) => ({ ...draft, date: value }));
                    }}
                  />
                </label>
              </div>
              <textarea
                className="notes-workspace__content-input"
                aria-label="Diary entry content"
                value={diaryDraft.content}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDiaryDraft((draft) => ({ ...draft, content: value }));
                }}
                placeholder="What is present for you today?"
              />
              <MetadataRow>
                <label className="notes-workspace__meta-field">
                  <span>Mood</span>
                  <select
                    aria-label="Diary mood"
                    value={diaryDraft.mood}
                    onChange={(event) => {
                      const value = event.currentTarget.value as DiaryDraft["mood"];
                      setDiaryDraft((draft) => ({ ...draft, mood: value }));
                    }}
                  >
                    <option value="">No mood</option>
                    {MOODS.map((mood) => <option key={mood.value} value={mood.value}>{mood.label}</option>)}
                  </select>
                </label>
                <label className="notes-workspace__meta-field">
                  <span>Tags</span>
                  <input
                    aria-label="Diary entry tags"
                    value={diaryDraft.tags}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDiaryDraft((draft) => ({ ...draft, tags: value }));
                    }}
                    placeholder="rest, family"
                  />
                </label>
                <label className="notes-workspace__check-field">
                  <input
                    type="checkbox"
                    checked={diaryDraft.isFavorite}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setDiaryDraft((draft) => ({ ...draft, isFavorite: checked }));
                    }}
                  />
                  <span>Favorite</span>
                </label>
                <span className="notes-workspace__word-count">{countWords(diaryDraft.content)} words</span>
              </MetadataRow>
            </>
          )}

          {error ? <p className="notes-workspace__error" role="alert">{error}</p> : null}

          <footer className="notes-workspace__editor-footer">
            {editor.id ? (
              deletePending ? (
                <div className="notes-workspace__delete-confirm" role="alert">
                  <span>Delete this {mode === "notes" ? "note" : "entry"}?</span>
                  <button type="button" onClick={deleteActive}>Delete</button>
                  <button type="button" onClick={() => setDeletePending(false)}>Keep it</button>
                </div>
              ) : (
                <IconButton label={`Delete ${mode === "notes" ? "note" : "entry"}`} tooltip="Delete" onClick={() => setDeletePending(true)}>
                  <TrashIcon />
                </IconButton>
              )
            ) : <span />}
            <div className="notes-workspace__save-actions">
              <span className="notes-workspace__offline-note"><LockIcon /> Local-first</span>
              <button className="notes-workspace__secondary-button" type="button" onClick={() => startNew()}>
                Clear
              </button>
              <button className="notes-workspace__save-button" type="submit">
                Save {mode === "notes" ? "note" : "entry"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </section>
  );
}

function MetadataRow({ children }: { children: ReactNode }) {
  return <div className="notes-workspace__metadata">{children}</div>;
}

function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="notes-workspace__icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function PlusIcon() {
  return <Icon><path d="M12 5v14M5 12h14" /></Icon>;
}

function SearchIcon() {
  return <Icon><circle cx="10.8" cy="10.8" r="6.2" /><path d="m16 16 4.2 4.2" /></Icon>;
}

function CloseIcon() {
  return <Icon><path d="m6 6 12 12M18 6 6 18" /></Icon>;
}

function LockIcon() {
  return <Icon><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>;
}

function PinIcon() {
  return <Icon><path d="m9 4 6 6M8 9l7 7M14 3l7 7-3 1-4 4-1 3-7-7 3-1 4-4 1-3Z" /></Icon>;
}

function FavoriteIcon() {
  return <Icon><path d="m12 19-1.5-1.3C6 13.6 3 10.8 3 7.5A4.5 4.5 0 0 1 7.5 3c1.8 0 3.5.8 4.5 2.2A5.4 5.4 0 0 1 16.5 3 4.5 4.5 0 0 1 21 7.5c0 3.3-3 6.1-7.5 10.2L12 19Z" /></Icon>;
}

function TrashIcon() {
  return <Icon><path d="M4.5 7.5h15M9 7.5V5h6v2.5M7 7.5l.7 12h8.6l.7-12M10 11v5M14 11v5" /></Icon>;
}

function BookIcon() {
  return <Icon><path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 0 5 23V4.5Z" /><path d="M5 19.5h10.5M8 8h7M8 11.5h6" /></Icon>;
}
